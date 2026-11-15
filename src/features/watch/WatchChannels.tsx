import { MonitorPlay, Star, Tv, Wifi, WifiOff } from 'lucide-react';

import { Button, EmptyState, IconButton, StatTile } from '../../kit';
import type { KinoChannel } from './watchShared';

function ChannelLogo({ channel, tile = false }: { channel: KinoChannel; tile?: boolean }) {
  return (
    <span className={tile ? 'watch-channel-logo watch-channel-logo--tile' : 'watch-channel-logo'}>
      {channel.logo ? (
        <img
          src={channel.logo}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).hidden = true;
          }}
        />
      ) : (
        <Tv size={tile ? 26 : 16} aria-hidden />
      )}
    </span>
  );
}

/** One catalog entry; `layout` only changes the shape, not the content or actions. */
export function ChannelItem({
  channel,
  active,
  favorite,
  layout,
  onSelect,
  onToggleFavorite,
}: {
  channel: KinoChannel;
  active: boolean;
  favorite: boolean;
  layout: 'row' | 'tile';
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const available = Boolean(channel.url);
  return (
    <li className={`watch-channel watch-channel--${layout}${active ? ' is-active' : ''}`}>
      <Button
        variant="quiet"
        className="watch-channel-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={channel.title}
      >
        <ChannelLogo channel={channel} tile={layout === 'tile'} />
        <span className="watch-channel-title">{channel.title}</span>
      </Button>
      <span
        className={`watch-channel-availability${available ? '' : ' is-off'}`}
        role="img"
        aria-label={available ? 'Поток есть' : 'Потока нет'}
        title={available ? 'Поток есть' : 'Потока нет'}
      >
        {available ? <Wifi size={12} aria-hidden /> : <WifiOff size={12} aria-hidden />}
      </span>
      <IconButton
        small
        className="watch-fav-toggle"
        icon={<Star size={14} aria-hidden fill={favorite ? 'currentColor' : 'none'} />}
        aria-label={`${favorite ? 'Убрать из избранного' : 'В избранное'}: ${channel.title}`}
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      />
    </li>
  );
}

/** The stage before a channel is picked: a kit empty state, real counts and the shortcuts. */
export function ChannelInfoPanel({
  channelsCount,
  favoritesCount,
}: {
  channelsCount: number;
  favoritesCount: number;
}) {
  return (
    <div className="watch-info-panel">
      <EmptyState
        className="watch-info-empty"
        icon={<MonitorPlay size={20} aria-hidden />}
        title="Выберите канал"
        message="Список каналов слева."
      />
      <div className="watch-info-facts">
        <StatTile label="Каналов в каталоге" value={channelsCount} />
        <StatTile label="В избранном" value={favoritesCount} />
      </div>
      <ul className="watch-shortcuts">
        <li>
          <kbd>Пробел</kbd> пауза / воспроизведение
        </li>
        <li>
          <kbd>M</kbd> звук вкл / выкл
        </li>
        <li>
          <kbd>F</kbd> на весь экран, <kbd>Esc</kbd> выйти
        </li>
      </ul>
    </div>
  );
}
