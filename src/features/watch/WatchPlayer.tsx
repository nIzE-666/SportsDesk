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
import { Badge, Button, EmptyState, IconButton } from '../../kit';
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
      <IconButton
        icon={playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        onClick={onTogglePlay}
        aria-label={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'}
        disabled={status !== 'ready'}
      />

      <div className="watch-volume-group">
        <IconButton
          icon={
            muted || volume === 0 ? (
              <VolumeX size={18} aria-hidden />
            ) : (
              <Volume2 size={18} aria-hidden />
            )
          }
          onClick={onToggleMute}
          aria-label={muted ? 'Включить звук (M)' : 'Выключить звук (M)'}
          disabled={status !== 'ready'}
        />
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

      {status === 'ready' && (
        <Badge variant="live">
          <span className="watch-dot" /> LIVE
        </Badge>
      )}

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
        <IconButton
          icon={<PictureInPicture2 size={18} aria-hidden />}
          onClick={onTogglePip}
          aria-label={pipActive ? 'Выйти из мини-плеера' : 'Мини-плеер поверх окон (PiP)'}
          disabled={status !== 'ready'}
          title={pipActive ? 'Выйти из мини-плеера' : 'Мини-плеер поверх окон'}
        />
      )}

      <IconButton
        icon={fullscreen ? <Minimize size={18} aria-hidden /> : <Maximize size={18} aria-hidden />}
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'}
      />
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
    let failed = false;
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    const onPlayable = () => {
      if (disposed || failed || retryTimer.current !== null) return;
      retryCount.current = 0;
      setStatus('ready');
    };
    const startPlayback = () => {
      if (!disposed && !failed)
        video.play().catch(() => {
          if (!disposed && !failed) setPlaying(false);
        });
    };
    const fail = (message: string) => {
      if (disposed || failed) return;
      failed = true;
      clearRetry();
      setStatus('error');
      setError(message);
      destroyHls();
    };
    const recover = (operation: () => void, backoff: number, message: string) => {
      if (disposed || failed || retryTimer.current !== null) return;
      if (retryCount.current >= 2) {
        fail(message);
        return;
      }
      retryCount.current += 1;
      setStatus('loading');
      setError(null);
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null;
        if (disposed || failed) return;
        try {
          operation();
        } catch {
          fail(message);
        }
      }, backoff * retryCount.current);
    };
    const onNativeError = () =>
      recover(
        () => video.load(),
        900,
        'Поток недоступен. Попробуйте ещё раз или откройте на сайте.',
      );

    video.addEventListener('canplay', onPlayable);
    video.addEventListener('playing', onPlayable);

    const attachHlsJs = () => {
      // Dynamic import keeps hls.js out of the initial auth screens.
      import('hls.js')
        .then((mod) => {
          if (disposed) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) {
            fail('Этот браузер/движок не поддерживает HLS-воспроизведение.');
            return;
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
          });
          hlsRef.current = hls;
          let manifestParsed = false;

          hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
            if (disposed || failed) return;
            manifestParsed = true;
            const parsed = data.levels.map((l, i) => ({
              index: i,
              height: l.height,
              bitrate: l.bitrate,
            }));
            setLevels(parsed);
            setLevelsUseful(parsed.length > 1);
            startPlayback();
          });

          hls.on(Hls.Events.FRAG_BUFFERED, (_evt, { frag }) => {
            if (
              frag.type === 'main' &&
              frag.sn !== 'initSegment' &&
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            ) {
              onPlayable();
            }
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
            if (disposed || failed) return;
            if (hls.autoLevelEnabled) setCurrentLevel(-1);
            else setCurrentLevel(data.level);
          });

          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              recover(
                () => (manifestParsed ? hls.startLoad() : hls.loadSource(url)),
                800,
                'Поток недоступен (сеть или регион).',
              );
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              recover(() => hls.recoverMediaError(), 800, 'Не удалось восстановить поток.');
            } else {
              fail('Ошибка воспроизведения потока.');
            }
          });

          hls.loadSource(url);
          hls.attachMedia(video);
        })
        .catch(() => fail('Не удалось загрузить видеодвижок HLS.'));
    };

    if (nativeHls) {
      // Native HLS path (Safari/WebKit-style engines in Tauri on some OSes).
      video.addEventListener('loadedmetadata', startPlayback);
      video.addEventListener('error', onNativeError);
      video.src = url;
    } else {
      attachHlsJs();
    }

    return () => {
      disposed = true;
      video.removeEventListener('canplay', onPlayable);
      video.removeEventListener('playing', onPlayable);
      video.removeEventListener('loadedmetadata', startPlayback);
      video.removeEventListener('error', onNativeError);
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

  // Player shortcuts leave dialogs and interactive controls in charge of their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        document.querySelector('[aria-modal="true"]') ||
        (e.target instanceof Element &&
          e.target.closest(
            'input, textarea, select, button, a[href], [contenteditable], [role="button"]',
          ))
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
      <div className="watch-player-canvas scheme-dark" onClick={togglePlay} role="presentation">
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
                <Loader2 size={26} className="spin" aria-hidden />
                <span>Подключаем поток…</span>
              </div>
            )}
            {status === 'idle' && (
              <EmptyState
                className="watch-player-idle"
                icon={<WifiOff size={20} aria-hidden />}
                message="Для этого канала нет потока."
                action={
                  <Button icon={<ExternalLink size={15} aria-hidden />} onClick={openSite}>
                    Открыть на сайте
                  </Button>
                }
              />
            )}
            {status === 'error' && (
              <EmptyState
                className="watch-player-error"
                tone="error"
                title="Не удалось воспроизвести поток"
                icon={<AlertTriangle size={20} aria-hidden />}
                message={error ?? 'Попробуйте ещё раз.'}
                action={
                  <Button
                    variant="primary"
                    icon={<RefreshCw size={15} aria-hidden />}
                    onClick={retry}
                  >
                    Повторить
                  </Button>
                }
              />
            )}
          </div>
        )}

        <Badge className="watch-player-title">
          <Tv size={14} aria-hidden />
          <span>{channel.title}</span>
        </Badge>

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
        <Button
          variant="quiet"
          small
          icon={<ExternalLink size={13} aria-hidden />}
          onClick={onOpenSitePage}
        >
          Открыть канал на сайте
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logout confirm
// ---------------------------------------------------------------------------
