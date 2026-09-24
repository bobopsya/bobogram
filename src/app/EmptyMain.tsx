import { useTranslation } from 'react-i18next';

export function EmptyMain() {
  const { t } = useTranslation();
  return (
    <div className="empty-main">
      <span className="pill">{t('chat.selectChat')}</span>
    </div>
  );
}
