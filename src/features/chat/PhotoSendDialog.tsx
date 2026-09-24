import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../ui/Modal';
import { MESSAGE_MAX_LENGTH } from '../../supabase/types';

/** Предпросмотр выбранных фото и подпись перед отправкой. */
export function PhotoSendDialog({
  files,
  initialCaption,
  onCancel,
  onSend,
}: {
  files: File[];
  initialCaption: string;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState(initialCaption.trim());
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <Modal
      title={t('media.sendPhotos', { count: files.length })}
      onClose={onCancel}
      footer={
        <button className="btn btn-primary" onClick={() => onSend(caption.trim())}>
          {t('chat.send')}
        </button>
      }
    >
      <div className={files.length > 1 ? 'photo-previews grid' : 'photo-previews'}>
        {previews.map((u) => (
          <img key={u} src={u} alt="" />
        ))}
      </div>
      <label className="field">
        <input
          value={caption}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={t('media.caption')}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend(caption.trim());
            }
          }}
          autoFocus
        />
      </label>
    </Modal>
  );
}
