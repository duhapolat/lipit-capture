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
        assert!(validate_public_http_url("https://www.youtube.com/watch?v=test", 4096).is_ok());
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
}
