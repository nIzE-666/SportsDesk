import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WeekendPoint } from './weekendData';

export function ComparisonChart({
  series,
  a,
  b,
}: {
  series: WeekendPoint[];
  a: string;
  b: string;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>Каждый этап сезона</h2>
        <span className="muted small">Позиции в гонках: меньше — выше</span>
      </div>
      <div className="season-chart">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series} margin={{ top: 15, right: 20, bottom: 10, left: -20 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="round"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              reversed
              domain={[1, 'dataMax']}
              allowDecimals={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              labelFormatter={(value) => `Этап ${value}`}
              contentStyle={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 15 }} />
            <Line
              name={a}
              dataKey="aPosition"
              stroke="#ff6763"
              strokeWidth={2.5}
              connectNulls={false}
              dot={{ r: 3 }}
            />
            <Line
              name={b}
              dataKey="bPosition"
              stroke="#71b9ff"
              strokeWidth={2.5}
              connectNulls={false}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small">Разрыв линии — нет финиша или результата.</p>
    </section>
  );
}
