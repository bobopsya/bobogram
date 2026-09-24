import { Icon, type IconName } from './Icon';

const COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function initials(name: string): string {
  const parts = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const second = parts.length > 1 ? (Array.from(parts[1])[0] ?? '') : '';
  return (first + second).toUpperCase();
}

interface Props {
  name: string;
  seed: string;
  src?: string | null;
  size?: number;
  icon?: IconName;
  online?: boolean;
}

export function Avatar({ name, seed, src, size = 48, icon, online }: Props) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className="avatar-fallback" style={{ background: colorFor(seed) }}>
          {icon ? <Icon name={icon} size={size * 0.5} /> : initials(name)}
        </div>
      )}
      {online && <span className="avatar-online" />}
    </div>
  );
}
