import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ReactNode, ErrorInfo } from 'react';
import { Component, Fragment } from 'react';
import { recordUiError, type UiError } from '../lib/diagnostics';

interface Props {
  children: ReactNode;
  resetKey: string;
  name?: string;
  onBack?: () => void;
}
interface State {
  failed: boolean;
  resetKey: string;
  attempt: number;
}
export class SectionBoundary extends Component<Props, State> {
  details: UiError | null = null;
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.details = recordUiError(
      this.props.name ?? this.props.resetKey,
      error,
      info.componentStack ?? '',
    );
  }
  state: State = { failed: false, resetKey: this.props.resetKey, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey, attempt: 0 };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="panel section-failure" role="alert">
          <AlertTriangle size={25} />
          <h2>{this.props.name ?? 'Раздел'} временно недоступен</h2>
          <p className="muted">
            Не удалось показать этот экран. Сохранённые настройки доступны; остальные разделы можно
            открыть через меню.
          </p>
          <div className="settings-actions">
            <button
              className="primary-btn"
              onClick={() =>
                this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))
              }
            >
              <RefreshCw size={15} /> Повторить
            </button>
            <button
              className="ghost-btn"
              onClick={async (event) => {
                const button = event.currentTarget;
                try {
                  await navigator.clipboard.writeText(JSON.stringify(this.details, null, 2));
                  button.textContent = 'Детали скопированы';
                } catch {
                  button.textContent = 'Копирование недоступно';
                }
              }}
            >
              Скопировать детали ошибки
            </button>
            {this.props.onBack && (
              <button className="ghost-btn" onClick={this.props.onBack}>
                Вернуться назад
              </button>
            )}
          </div>
        </section>
      );
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
