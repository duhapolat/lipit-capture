import { CircleAlert } from "lucide-react";
import { Dialog } from "./Dialog";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  return (
    <Dialog className="confirm-modal" labelledBy="confirm-title" onClose={onClose}>
      <div className="confirm-body">
        <span className={`side-icon ${request.destructive ? "danger" : ""}`}>
          <CircleAlert size={18} />
        </span>
        <div>
          <h2 id="confirm-title">{request.title}</h2>
          <p>{request.message}</p>
        </div>
      </div>
      <div className="confirm-actions">
        <button className="settings-cancel-button" type="button" onClick={onClose}>
          Vazgeç
        </button>
        <button
          className={`primary-button ${request.destructive ? "danger" : ""}`}
          type="button"
          onClick={() => {
            onClose();
            void request.onConfirm();
          }}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
