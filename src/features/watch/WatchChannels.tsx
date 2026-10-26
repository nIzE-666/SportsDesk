import { ArrowLeftRight, Star, Tv, WifiOff } from 'lucide-react';

import type { KinoChannel } from './watchShared';
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
      <button
        type="button"
        className="watch-channel-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
      >
        <span className="watch-channel-logo">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Tv size={16} aria-hidden />
          )}
        </span>
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
      </button>
      <button
        type="button"
        className={`watch-fav-toggle${favorite ? ' is-on' : ''}`}
        aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={onToggleFavorite}
      >
        <Star size={14} aria-hidden fill={favorite ? 'currentColor' : 'none'} />
      </button>
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
      <button
        type="button"
        className="watch-tile-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        title={channel.title}
      >
        <span className="watch-tile-logo">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Tv size={26} aria-hidden />
          )}
        </span>
        <span className="watch-tile-title">{channel.title}</span>
        {!channel.url && (
          <span className="watch-tile-off" title="Поток недоступен">
            <WifiOff size={11} aria-hidden />
          </span>
        )}
      </button>
      <button
        type="button"
        className={`watch-fav-toggle${favorite ? ' is-on' : ''}`}
        aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={onToggleFavorite}
      >
        <Star size={13} aria-hidden fill={favorite ? 'currentColor' : 'none'} />
      </button>
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
        <h2>Выберите канал</h2>
        <p className="watch-muted">
          Выберите канал в списке слева. Воспроизведение запускается по клику — звук не включается
          автоматически.
        </p>
      </div>
      <div className="watch-info-facts">
        <div className="watch-fact">
          <span className="watch-fact-label">Доступные каналы</span>
          <span className="watch-fact-value">{channelsCount}</span>
        </div>
        <div className="watch-fact">
          <span className="watch-fact-label">В избранном</span>
          <span className="watch-fact-value">{favoritesCount}</span>
        </div>
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
