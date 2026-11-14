import { findMeetingForRound, isCompleted } from './analysisChoice';
import { meetingLabel, sessionLabel } from './analysisLabels';
import { grandPrixTitle } from './calendarModel';
import { Compare } from './Compare';
import { F1_ANALYSIS_MODES, type F1AnalysisMode } from './f1Tabs';
import { useSeason } from './SeasonContext';
import { Session } from './Session';
import { useAnalysisSelection } from './useAnalysisSelection';

export function F1Analysis({
  mode,
  onModeChange,
}: {
  mode: F1AnalysisMode;
  onModeChange: (mode: F1AnalysisMode) => void;
}) {
  const { year } = useSeason();
  const analysis = useAnalysisSelection(year, mode);
  const gpValue = analysis.choice.round === 'season' ? 'season' : String(analysis.choice.round);
  const knownRound = analysis.rounds.some((round) => Number(round.round) === analysis.choice.round);

  const chooseRound = (value: string) => {
    if (value === 'season') {
      analysis.setChoice({ round: 'season', meeting: null, session: null });
      return;
    }
    const round = Number(value);
    if (!Number.isInteger(round) || round <= 0) return;
    const meeting = findMeetingForRound(round, analysis.rounds, analysis.meetingList);
    analysis.setChoice({ round, meeting: meeting?.meeting_key ?? null, session: null });
  };

  return (
    <div className="f1-analysis">
      <div className="f1-tabs f1-analysis-modes" role="tablist" aria-label="Режим анализа">
        {F1_ANALYSIS_MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className="f1-tab"
            onClick={() => onModeChange(id)}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="f1-analysis-choice">
        <div className="f1-muted f1-analysis-field">
          <span>Гран-при</span>
          <select
            className="f1-select"
            aria-label="Гран-при"
            value={gpValue}
            onChange={(event) => chooseRound(event.target.value)}
          >
            <option value="season">Весь сезон {year}</option>
            {analysis.choice.round !== 'season' && !knownRound ? (
              <option value={analysis.choice.round}>Этап {analysis.choice.round}</option>
            ) : null}
            {analysis.rounds.map((round) => (
              <option key={round.round} value={round.round}>
                {round.round}. {grandPrixTitle(round.raceName).title}
              </option>
            ))}
          </select>
        </div>
        <div className="f1-muted f1-analysis-field">
          <span>Сессия</span>
          <select
            className="f1-select"
            aria-label="Сессия"
            value={analysis.session?.session_key ?? ''}
            onChange={(event) =>
              analysis.setChoice((current) => ({
                ...current,
                session: event.target.value ? Number(event.target.value) : null,
              }))
            }
            disabled={!analysis.meeting || analysis.fallback || analysis.sessionList.length === 0}
          >
            {analysis.sessionList.length === 0 ? <option value="">Нет данных</option> : null}
            {analysis.sessionList.length > 0 && !analysis.session ? (
              <option value="">Не выбрана</option>
            ) : null}
            {analysis.sessionList.map((session) => (
              <option key={session.session_key} value={session.session_key}>
                {sessionLabel(session)}
                {isCompleted(session, Date.now()) ? '' : ' (предстоит)'}
              </option>
            ))}
          </select>
        </div>
        {analysis.meeting ? (
          <span className="f1-muted f1-analysis-current">{meetingLabel(analysis.meeting)}</span>
        ) : null}
      </div>

      {analysis.notice ? (
        <p className="f1-analysis-note" role="status">
          {analysis.notice}
        </p>
      ) : null}

      {mode === 'compare' ? <Compare round={analysis.choice.round} /> : null}
      {mode === 'pace' ? <Session mode="pace" analysis={analysis} /> : null}
      {mode === 'session' ? <Session analysis={analysis} /> : null}
    </div>
  );
}
