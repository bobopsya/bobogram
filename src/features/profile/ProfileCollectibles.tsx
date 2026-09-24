import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '../../supabase/types';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';

interface ProfileCollectible {
  id: string;
  name: string;
  number: number;
  model: string;
  backdrop: string;
  symbol: string;
  image: string;
  gradient: string;
}

const MODELS = ['Bobo Classic', 'Cozy Headphones', 'Late Night'];
const BACKDROPS = ['Electric Purple', 'Telegram Sky', 'Soft Peach'];
const SYMBOLS = ['Signal', 'Headphones', 'Star'];
const ASSET_BASE = import.meta.env.BASE_URL;

function hashUid(uid: string): number {
  let hash = 0;
  for (let i = 0; i < uid.length; i += 1) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return hash;
}

function collectibleFor(profile: UserProfile): ProfileCollectible {
  const hash = hashUid(profile.uid);
  return {
    id: `bobo-${hash % 10000}`,
    name: 'Bobo Headphones',
    number: 100 + (hash % 900),
    model: MODELS[hash % MODELS.length],
    backdrop: BACKDROPS[Math.floor(hash / 3) % BACKDROPS.length],
    symbol: SYMBOLS[Math.floor(hash / 7) % SYMBOLS.length],
    image: `${ASSET_BASE}nft-bobo-headphones.png`,
    gradient:
      hash % 2 === 0
        ? 'linear-gradient(145deg, #c765d8 0%, #8e5ce8 58%, #7159d9 100%)'
        : 'linear-gradient(145deg, #e58ab7 0%, #9a70e5 56%, #668cf0 100%)',
  };
}

export function ProfileCollectibles({ profile }: { profile: UserProfile }) {
  const { t } = useTranslation();
  const collectible = useMemo(() => collectibleFor(profile), [profile]);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="profile-collectibles section">
        <div className="section-title">{t('profile.collectibles')}</div>
        <button className="collectible-card" onClick={() => setOpen(true)}>
          <div className="collectible-art" style={{ background: collectible.gradient }}>
            <img src={collectible.image} alt="" />
            <span className="collectible-corner">{t('profile.collectibleGift')}</span>
          </div>
          <div className="collectible-body">
            <div className="collectible-title-row">
              <span className="collectible-title">{collectible.name}</span>
              <span className="collectible-token">#{collectible.number}</span>
            </div>
            <div className="muted small">{t('profile.collectibleHint')}</div>
            <div className="collectible-meta">
              <span>{collectible.model}</span>
              <span>{collectible.backdrop}</span>
              <span>{collectible.symbol}</span>
            </div>
          </div>
          <Icon name="arrowOut" />
        </button>
      </div>

      {open && (
        <Modal title={t('profile.collectible')} onClose={() => setOpen(false)}>
          <div className="collectible-modal">
            <div className="collectible-preview" style={{ background: collectible.gradient }}>
              <img src={collectible.image} alt="" />
              <span className="collectible-corner">{t('profile.collectibleGift')}</span>
            </div>
            <h3>
              {collectible.name} #{collectible.number}
            </h3>
            <div className="collectible-details">
              <div>
                <span>{t('profile.collectibleModel')}</span>
                <b>{collectible.model}</b>
              </div>
              <div>
                <span>{t('profile.collectibleBackdrop')}</span>
                <b>{collectible.backdrop}</b>
              </div>
              <div>
                <span>{t('profile.collectibleSymbol')}</span>
                <b>{collectible.symbol}</b>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
