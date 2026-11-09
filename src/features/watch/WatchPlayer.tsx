import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  Tv,
  Volume2,
  VolumeX,
  WifiOff,
  PictureInPicture2,
} from 'lucide-react';
import { openExternal } from '../../lib/bridge';
import { reportVideoAudible } from '../atmosphere/playbackContext';

import type { KinoChannel } from './watchShared';
import { siteUrlForChannel } from './watchShared';
type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PlayerLevel {
  index: number;
  height: number;
  bitrate: number;
}

interface PlayerControlsProps {
  status: PlayerStatus;
  playing: boolean;
  muted: boolean;
  volume: number;
  fullscreen: boolean;
  pipSupported: boolean;
  pipActive: boolean;
  levels: PlayerLevel[];
  currentLevel: number; // -1 = auto
  levelsUseful: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  onLevel: (index: number) => void;
}

function PlayerControls({
  status,
  playing,
  muted,
  volume,
  fullscreen,
  pipSupported,
  pipActive,
  levels,
  currentLevel,
  levelsUseful,
  onTogglePlay,
  onToggleMute,
  onVolume,
  onToggleFullscreen,
  onTogglePip,
  onLevel,
}: PlayerControlsProps) {
  return (
    <div className="watch-player-controls" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="watch-ctrl"
        onClick={onTogglePlay}
        aria-label={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'}
        disabled={status !== 'ready'}
      >
        {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>

      <div className="watch-volume-group">
        <button
          type="button"
          className="watch-ctrl"
          onClick={onToggleMute}
          aria-label={muted ? 'Включить звук (M)' : 'Выключить звук (M)'}
          disabled={status !== 'ready'}
        >
          {muted || volume === 0 ? (
            <VolumeX size={18} aria-hidden />
          ) : (
            <Volume2 size={18} aria-hidden />
          )}
        </button>
        <input
          className="watch-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          aria-label="Громкость"
          disabled={status !== 'ready'}
        />
      </div>

      <span className="watch-live-pill">
        <span className="watch-dot" /> LIVE
      </span>

      <div className="watch-player-spacer" />

      {levelsUseful && levels.length > 0 && (
        <label className="watch-level-select">
          <span className="watch-muted">Качество</span>
          <select
            value={currentLevel}
            onChange={(e) => onLevel(Number(e.target.value))}
            aria-label="Качество видео"
          >
            <option value={-1}>Авто</option>
            {levels.map((l) => (
              <option key={l.index} value={l.index}>
                {l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} кбит/с`}
              </option>
            ))}
          </select>
        </label>
      )}

      {pipSupported && (
        <button
          type="button"
          className="watch-ctrl"
          onClick={onTogglePip}
          aria-label={pipActive ? 'Выйти из мини-плеера' : 'Мини-плеер поверх окон (PiP)'}
          disabled={status !== 'ready'}
          title={pipActive ? 'Выйти из мини-плеера' : 'Мини-плеер поверх окон'}
        >
          <PictureInPicture2 size={18} aria-hidden />
        </button>
      )}

      <button
        type="button"
        className="watch-ctrl"
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'}
      >
        {fullscreen ? <Minimize size={18} aria-hidden /> : <Maximize size={18} aria-hidden />}
      </button>
    </div>
  );
}

interface PlayerPaneProps {
  channel: KinoChannel;
  onOpenSite: () => void;
  onOpenSitePage: () => void;
}

export function PlayerPane({ channel, onOpenSite, onOpenSitePage }: PlayerPaneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const retryTimer = useRef<number | null>(null);
  const retryCount = useRef(0);
  const hideTimer = useRef<number | null>(null);

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true); // no autoplay sound
  const [volume, setVolume] = useState(0.8);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [levels, setLevels] = useState<PlayerLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [levelsUseful, setLevelsUseful] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const url = channel.url ?? '';

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }
  }, []);

  // Full teardown whenever channel/url/retry changes or unmount.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    destroyHls();
    clearRetry();
    retryCount.current = 0;
    setLevels([]);
    setCurrentLevel(-1);
    setLevelsUseful(false);
    setError(null);
    setPlaying(false);

    // Reset element cleanly so old MSE buffers are released.
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // ignore
    }

    if (!url) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    video.muted = true;
    setMuted(true);
    video.volume = volume;

    let disposed = false;
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    const attachHlsJs = () => {
      // Dynamic import keeps hls.js out of the initial auth screens.
      import('hls.js')
        .then((mod) => {
          if (disposed) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) {
            setStatus('error');
            setError('Этот браузер/движок не поддерживает HLS-воспроизведение.');
            return;
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
          });
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
            if (disposed) return;
            const parsed = data.levels.map((l, i) => ({
              index: i,
              height: l.height,
              bitrate: l.bitrate,
            }));
            setLevels(parsed);
            setLevelsUseful(parsed.length > 1);
            setStatus('ready');
            // Attempt muted autoplay only; unmuted needs a click.
            video.play().catch(() => {
              setPlaying(false);
            });
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
            if (disposed) return;
            if (hls.autoLevelEnabled) setCurrentLevel(-1);
            else setCurrentLevel(data.level);
          });

          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (disposed || !data.fatal) return;
            // Bounded retry: 2 attempts with backoff, then honest failure.
            if (retryCount.current < 2) {
              retryCount.current += 1;
              const delay = 800 * retryCount.current;
              setStatus('loading');
              setError(null);
              clearRetry();
              retryTimer.current = window.setTimeout(() => {
                if (disposed) return;
                try {
                  hls.startLoad();
                  setStatus('ready');
                } catch {
                  setStatus('error');
                  setError('Не удалось восстановить поток.');
                }
              }, delay);
            } else {
              setStatus('error');
              setError(
                data.type === 'networkError'
                  ? 'Поток недоступен (сеть или регион).'
                  : 'Ошибка воспроизведения потока.',
              );
              destroyHls();
            }
          });

          hls.loadSource(url);
          hls.attachMedia(video);
        })
        .catch(() => {
          if (!disposed) {
            setStatus('error');
            setError('Не удалось загрузить видеодвижок HLS.');
          }
        });
    };

    if (nativeHls) {
      // Native HLS path (Safari/WebKit-style engines in Tauri on some OSes).
      video.src = url;
      const onLoaded = () => {
        if (disposed) return;
        setStatus('ready');
        setLevelsUseful(false);
        setLevels([]);
        video.play().catch(() => setPlaying(false));
      };
      const onErr = () => {
        if (disposed) return;
        if (retryCount.current < 2) {
          retryCount.current += 1;
          clearRetry();
          retryTimer.current = window.setTimeout(() => {
            if (!disposed) {
              video.load();
              video.play().catch(() => setPlaying(false));
            }
          }, 900 * retryCount.current);
        } else {
          setStatus('error');
          setError('Поток недоступен. Попробуйте ещё раз или откройте на сайте.');
        }
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onErr);
      return () => {
        disposed = true;
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onErr);
        clearRetry();
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          // ignore
        }
      };
    }

    attachHlsJs();

    return () => {
      disposed = true;
      clearRetry();
      destroyHls();
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // ignore
      }
    };
  }, [url, reloadNonce]);

  // Sync media state → UI
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (!muted && volume > 0) video.volume = volume;
  }, [muted, volume]);

  // Фон и короткие сигналы атмосферы не накладываются на звук трансляции.
  const audioReportId = useId();
  useEffect(() => {
    reportVideoAudible(audioReportId, playing && !muted && volume > 0);
    return () => reportVideoAudible(audioReportId, false);
  }, [audioReportId, playing, muted, volume]);

  // Fullscreen state sync
  useEffect(() => {
    const onFs = () => {
      const active = document.fullscreenElement === shellRef.current;
      setFullscreen(active);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      shell.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // №10: PiP — мини-плеер поверх всех окон (нативный Chromium API).
  const pipSupported =
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    document.pictureInPictureEnabled;
  const [pipActive, setPipActive] = useState(false);
  useEffect(() => {
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    const video = videoRef.current;
    if (video) {
      video.addEventListener('enterpictureinpicture', onEnter);
      video.addEventListener('leavepictureinpicture', onLeave);
    }
    return () => {
      if (video) {
        video.removeEventListener('enterpictureinpicture', onEnter);
        video.removeEventListener('leavepictureinpicture', onLeave);
      }
    };
  }, []);
  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => undefined);
    } else {
      video.requestPictureInPicture().catch(() => undefined);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return;
    if (video.paused) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [status]);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const setVolumeValue = useCallback(
    (v: number) => {
      setVolume(v);
      if (v > 0 && muted) setMuted(false);
      if (v === 0) setMuted(true);
    },
    [muted],
  );

  const retry = useCallback(() => {
    retryCount.current = 0;
    setReloadNonce((n) => n + 1);
  }, []);

  const changeLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    setCurrentLevel(index);
    if (index === -1) {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
    } else {
      hls.currentLevel = index;
    }
  }, []);

  // Auto-hide controls while playing.
  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3200);
  }, []);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    } else {
      bumpControls();
    }
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [playing, bumpControls]);

  // Keyboard shortcuts (skip when typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        bumpControls();
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
        toggleMute();
        bumpControls();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        // Browser handles Escape to exit native fullscreen; nothing extra needed.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, toggleMute, toggleFullscreen, bumpControls]);

  const openSite = () => {
    openExternal(siteUrlForChannel(channel)).catch(() => undefined);
    onOpenSite();
  };

  return (
    <div
      ref={shellRef}
      className={`watch-player-shell${fullscreen ? ' is-fullscreen' : ''}${controlsVisible ? '' : ' hide-controls'}`}
      onMouseMove={bumpControls}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false);
      }}
    >
      <div className="watch-player-canvas" onClick={togglePlay} role="presentation">
        <video
          ref={videoRef}
          className="watch-video"
          playsInline
          muted={muted}
          controls={false}
          onContextMenu={(e) => e.preventDefault()}
        />

        {status !== 'ready' && (
          <div className="watch-player-overlay">
            {status === 'loading' && (
              <div className="watch-row-center">
                <Loader2 size={26} className="watch-spin" aria-hidden />
                <span>Подключаем поток…</span>
              </div>
            )}
            {status === 'idle' && (
              <div className="watch-player-idle">
                <WifiOff size={26} aria-hidden />
                <span>Для этого канала поток не возвращён API.</span>
                <button type="button" className="watch-btn watch-btn-ghost" onClick={openSite}>
                  <ExternalLink size={15} aria-hidden /> Открыть на сайте
                </button>
              </div>
            )}
            {status === 'error' && (
              <div className="watch-player-error">
                <AlertTriangle size={24} aria-hidden />
                <span>{error ?? 'Не удалось воспроизвести поток.'}</span>
                <div className="watch-player-error-actions">
                  <button type="button" className="watch-btn watch-btn-primary" onClick={retry}>
                    <RefreshCw size={15} aria-hidden /> Повторить
                  </button>
                  <button type="button" className="watch-btn watch-btn-ghost" onClick={openSite}>
                    <ExternalLink size={15} aria-hidden /> Открыть в браузере
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="watch-player-title">
          <Tv size={14} aria-hidden />
          <span>{channel.title}</span>
        </div>

        <PlayerControls
          status={status}
          playing={playing}
          muted={muted}
          volume={volume}
          fullscreen={fullscreen}
          pipSupported={pipSupported}
          pipActive={pipActive}
          levels={levels}
          currentLevel={currentLevel}
          levelsUseful={levelsUseful}
          onTogglePlay={togglePlay}
          onToggleMute={toggleMute}
          onVolume={setVolumeValue}
          onToggleFullscreen={toggleFullscreen}
          onTogglePip={togglePip}
          onLevel={changeLevel}
        />
      </div>

      <div className="watch-player-foot">
        <span className="watch-muted">
          Качество/дорожки показываются только если поток реально их предоставляет. Живой эфир без
          временной шкалы.
        </span>
        <button type="button" className="watch-link-btn" onClick={onOpenSitePage}>
          <ExternalLink size={13} aria-hidden /> канал на kino.watch
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logout confirm
// ---------------------------------------------------------------------------
