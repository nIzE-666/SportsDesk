import { ArrowLeftRight, Star, Tv, WifiOff } from 'lucide-react';

import { Button, IconButton, StatTile } from '../../kit';
import type { KinoChannel } from './watchShared';

function ChannelLogo({
  channel,
  size,
  tile = false,
}: {
  channel: KinoChannel;
  size: number;
  tile?: boolean;
}) {
  return (
    <span className={tile ? 'watch-tile-logo' : 'watch-channel-logo'}>
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
        <Tv size={size} aria-hidden />
      )}
    </span>
  );
}

export function ChannelListItem({
  channel,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  channel: KinoChannel;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <li className={`watch-channel-item${active ? ' is-active' : ''}`}>
      <Button
        variant="quiet"
        className="watch-channel-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
      >
        <ChannelLogo channel={channel} size={16} />
        <span className="watch-channel-title">{channel.title}</span>
        {channel.url ? (
          <span className="watch-channel-live" aria-label="поток доступен">
            <span className="watch-dot" />
          </span>
        ) : (
          <span className="watch-channel-live is-off" title="Поток недоступен">
            <WifiOff size={12} aria-hidden />
          </span>
        )}
      </Button>
      <IconButton
        small
        className={`watch-fav-toggle${favorite ? ' is-on' : ''}`}
        icon={<Star size={14} aria-hidden fill={favorite ? 'currentColor' : 'none'} />}
        aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={onToggleFavorite}
      />
    </li>
  );
}

// №10: карточка канала для сеточного вида — крупная эмблема + название.
export function ChannelTile({
  channel,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  channel: KinoChannel;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className={`watch-channel-tile${active ? ' is-active' : ''}`}>
      <Button
        variant="quiet"
        className="watch-tile-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={channel.title}
      >
        <ChannelLogo channel={channel} size={26} tile />
        <span className="watch-tile-title">{channel.title}</span>
        {!channel.url && (
          <span className="watch-tile-off" title="Поток недоступен">
            <WifiOff size={11} aria-hidden />
          </span>
        )}
      </Button>
      <IconButton
        small
        className={`watch-fav-toggle${favorite ? ' is-on' : ''}`}
        icon={<Star size={13} aria-hidden fill={favorite ? 'currentColor' : 'none'} />}
        aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={onToggleFavorite}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export function ChannelInfoPanel({
  channelsCount,
  favoritesCount,
}: {
  channelsCount: number;
  favoritesCount: number;
}) {
  return (
    <div className="watch-info-panel">
      <div className="watch-info-hero">
        <span className="watch-hero-icon">
          <ArrowLeftRight size={26} aria-hidden />
        </span>
        <h2 className="ui-section-title">Выберите канал</h2>
        <p className="watch-muted">Список каналов слева; воспроизведение по клику.</p>
      </div>
      <div className="watch-info-facts">
        <StatTile label="Доступные каналы" value={channelsCount} />
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
