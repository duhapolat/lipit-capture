use std::net::{Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use crate::models::AppError;

pub fn validate_public_http_url(raw: &str, max_len: usize) -> Result<Url, AppError> {
    if raw.len() > max_len || raw.trim() != raw {
        return Err(invalid_url());
    }
    let url = Url::parse(raw).map_err(|_| invalid_url())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err(AppError::new(
            "INVALID_URL",
            "Yalnızca HTTP veya HTTPS adresleri desteklenir.",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::new(
            "UNSAFE_URL",
            "Kullanıcı bilgisi içeren medya adresleri güvenlik nedeniyle kullanılamaz.",
        ));
    }
    let safe = match url.host() {
        Some(Host::Domain(domain)) => public_domain(domain),
        Some(Host::Ipv4(address)) => public_ipv4(address),
        Some(Host::Ipv6(address)) => public_ipv6(address),
        None => false,
    };
    if !safe {
        return Err(AppError::new(
            "UNSAFE_URL",
            "Yerel veya özel ağ adresleri güvenlik nedeniyle kullanılamaz.",
        ));
    }
    Ok(url)
}

/// Resolves the host and rejects names that point at loopback, private or
/// reserved addresses (e.g. public DNS names that resolve to 127.0.0.1).
///
/// This narrows, but cannot fully close, DNS rebinding: the media engine does
/// its own lookup later. Full isolation needs a sandboxed network helper.
pub async fn ensure_public_resolution(url: &Url) -> Result<(), AppError> {
    let Some(Host::Domain(domain)) = url.host() else {
        return Ok(());
    };
    let port = url.port_or_known_default().unwrap_or(443);
    let lookup = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tokio::net::lookup_host((domain.to_owned(), port)),
    )
    .await;
    let addresses: Vec<std::net::SocketAddr> = match lookup {
        Ok(Ok(addresses)) => addresses.collect(),
        _ => {
            return Err(AppError::new(
                "NETWORK_ERROR",
                "Alan adı çözümlenemedi. İnternet bağlantını kontrol edip tekrar dene.",
            ))
        }
    };
    if addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err(AppError::new(
            "UNSAFE_URL",
            "Bu alan adı yerel veya özel bir ağ adresine yönleniyor; güvenlik nedeniyle kullanılamaz.",
        ));
    }
    Ok(())
}

fn public_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(address) => public_ipv4(address),
        std::net::IpAddr::V6(address) => public_ipv6(address),
    }
}

fn invalid_url() -> AppError {
    AppError::new("INVALID_URL", "Geçerli bir medya adresi girin.")
}

fn public_domain(raw: &str) -> bool {
    let domain = raw.trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() || !domain.contains('.') {
        return false;
    }
    ![
        "localhost",
        "local",
        "lan",
        "internal",
        "home",
        "home.arpa",
        "test",
        "example",
        "invalid",
    ]
    .iter()
    .any(|suffix| domain == *suffix || domain.ends_with(&format!(".{suffix}")))
}

fn public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && matches!(b, 18 | 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113))
}

fn public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return public_ipv4(mapped);
    }
    let segments = address.segments();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xffc0) == 0xfec0
        || (segments[0] == 0x2001 && segments[1] == 0x0db8))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_web_addresses() {
        assert!(validate_public_http_url("https://media.example.org/watch?v=test", 4096).is_ok());
        assert!(validate_public_http_url("https://1.1.1.1/video.mp4", 4096).is_ok());
    }

    #[test]
    fn rejects_local_and_private_addresses() {
        for url in [
            "http://localhost/video.mp4",
            "http://service.local/video.mp4",
            "http://127.0.0.1/video.mp4",
            "http://10.0.0.1/video.mp4",
            "http://169.254.169.254/latest/meta-data",
            "http://192.168.1.1/video.mp4",
            "http://[::1]/video.mp4",
            "http://[fc00::1]/video.mp4",
            "http://[::ffff:127.0.0.1]/video.mp4",
        ] {
            assert_eq!(
                validate_public_http_url(url, 4096).unwrap_err().code,
                "UNSAFE_URL",
                "{url} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_embedded_credentials() {
        assert_eq!(
            validate_public_http_url("https://user:secret@example.com/video.mp4", 4096)
                .unwrap_err()
                .code,
            "UNSAFE_URL"
        );
    }

    #[test]
    fn classifies_resolved_addresses() {
        assert!(!public_ip("127.0.0.1".parse().unwrap()));
        assert!(!public_ip("10.1.2.3".parse().unwrap()));
        assert!(!public_ip("::1".parse().unwrap()));
        assert!(public_ip("1.1.1.1".parse().unwrap()));
    }
}
