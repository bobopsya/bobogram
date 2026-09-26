import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface Props {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Диалог по центру на ПК и «шторка» снизу на телефоне. */
export function Modal({ title, onClose, children, footer, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        onFocus={(e) => {
          // iPhone: поле, на которое нажали, — в видимую часть над клавиатурой, когда она выедет.
          const el = e.target;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 300);
          }
        }}
      >
        {title !== undefined && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="close">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  extra?: ReactNode;
}

export function Confirm({
  text,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onClose,
  extra,
}: ConfirmProps) {
  return (
    <Modal
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-text" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn btn-text danger' : 'btn btn-text'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{text}</p>
      {extra}
    </Modal>
  );
}
