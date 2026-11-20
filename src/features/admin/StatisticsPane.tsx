import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  FUNNEL_STEPS,
  type ByPlatform,
  type Counted,
  type Statistics,
  type StatsDay,
  type StatsPlatform,
  type StatsQuery,
  type StatsTiles,
} from "../../api/admin";
import { loadStatistics } from "../../lib/api";
import { firebaseConfig } from "../../lib/firebaseConfig";
import { useResource } from "../../lib/useResource";
import { currentLocale, fill, formatCount, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Icon } from "../../ui/Icon";
import { PaneLoading } from "./PaneLoading";
import { SearchesPane } from "./SearchesPane";
import {
  changeOf,
  csvOf,
  PERIODS,
  percentOf,
  rangeOf,
  sortRows,
  type CsvColumn,
  type Period,
} from "./statistics";
import "./statistics.css";

const words = () => strings.admin.statistics;

const CRASHLYTICS = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/crashlytics`;
const PLAY_CONSOLE = "https://play.google.com/console";
const SEARCH_CONSOLE = "https://search.google.com/search-console";

const periodLabel = (period: Period): string =>
  ({
    today: words().today,
    "7": words().days7,
    "30": words().days30,
    "90": words().days90,
    custom: words().custom,
  })[period];

const countText = (value: Counted): string => (value === null ? "—" : formatCount(value));
const shareText = (value: Counted): string => (value === null ? "—" : percentOf(value));

function nameOf(type: "language" | "region", code: string): string {
  try {
    return new Intl.DisplayNames([currentLocale()], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

const timeOf = (ms: number): string =>
  new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);

/** Opens the browser's save of a table as CSV, named after it and the period. */
function saveCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface Column<Row> extends CsvColumn<Row> {
  numeric?: boolean;
  show?: (row: Row) => ReactNode;
}

/** A table of one block: sorted by any column, saved as CSV, or "not counted yet" when empty. */
function StatTable<Row>({
  name,
  caption,
  columns,
  rows,
  file,
  hideCaption = false,
}: {
  name: string;
  caption: string;
  /** The block's own title already says it; the table keeps it as its name. */
  hideCaption?: boolean;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  file: string;
}) {
  const firstNumeric = columns.findIndex((column) => column.numeric);
  const [sort, setSort] = useState<{ column: number; descending: boolean }>({
    column: firstNumeric < 0 ? 0 : firstNumeric,
    descending: firstNumeric >= 0,
  });
  const sorted = useMemo(
    () => sortRows(rows, columns[sort.column]!.value, sort.descending),
    [rows, columns, sort],
  );
  if (rows.length === 0) {
    return (
      <div className="stats-table">
        {!hideCaption && <h4 className="stats-table__caption">{caption}</h4>}
        <p className="stats__none">{words().notCounted}</p>
      </div>
    );
  }
  return (
    <div className="stats-table">
      <div className="stats-table__head">
        {!hideCaption && <h4 className="stats-table__caption">{caption}</h4>}
        <Button
          variant="text"
          icon="download"
          onClick={() => saveCsv(`${file}-${name}`, csvOf(columns, sorted))}
        >
          {words().downloadCsv}
        </Button>
      </div>
      <div className="stats-table__scroll">
        <table aria-label={caption}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.label}
                  scope="col"
                  className={column.numeric ? "stats-table__num" : undefined}
                  aria-sort={
                    sort.column === index
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="stats-table__sort"
                    aria-label={fill(words().sortBy, { column: column.label })}
                    onClick={() =>
                      setSort((before) =>
                        before.column === index
                          ? { column: index, descending: !before.descending }
                          : { column: index, descending: column.numeric === true },
                      )
                    }
                  >
                    {column.label}
                    {sort.column === index && (
                      <Icon name={sort.descending ? "arrow_downward" : "arrow_upward"} />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td
                    key={column.label}
                    className={column.numeric ? "stats-table__num" : undefined}
                  >
                    {column.show
                      ? column.show(row)
                      : (() => {
                          const value = column.value(row);
                          return typeof value === "number" ? formatCount(value) : (value ?? "—");
                        })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TILES: { key: keyof StatsTiles; label: () => string; share: boolean }[] = [
  { key: "mau", label: () => words().mau, share: false },
  { key: "dauAverage", label: () => words().dauAverage, share: false },
  { key: "newUsers", label: () => words().newUsers, share: false },
  { key: "d7", label: () => words().d7, share: true },
  { key: "published", label: () => words().published, share: false },
  { key: "crashFreeUsers", label: () => words().crashFree, share: true },
];

/** Below 99.5% the crash-free tile turns red: a bad release shows the same day. */
const CRASH_FREE_FLOOR = 0.995;

function Tiles({ stats, compare }: { stats: Statistics; compare: boolean }) {
  return (
    <ul className="stats-tiles">
      {TILES.map(({ key, label, share }) => {
        const value = stats.tiles[key];
        const change = compare ? changeOf(value, stats.previous?.[key] ?? null, share) : null;
        const alarm = key === "crashFreeUsers" && value !== null && value < CRASH_FREE_FLOOR;
        const amount =
          change === null
            ? ""
            : change.points
              ? fill(words().points, { n: `${change.by > 0 ? "+" : ""}${change.by}` })
              : `${change.by > 0 ? "+" : ""}${change.by}%`;
        return (
          <li key={key} className={alarm ? "stats-tile stats-tile--alarm" : "stats-tile"}>
            <span className="stats-tile__label">{label()}</span>
            <span className="stats-tile__value">{share ? shareText(value) : countText(value)}</span>
            {change !== null && (
              <span
                className={`stats-tile__change stats-tile__change--${change.direction}`}
                title={
                  change.direction === "same"
                    ? words().changeSame
                    : fill(change.direction === "up" ? words().changeUp : words().changeDown, {
                        change: amount,
                      })
                }
              >
                {change.direction === "same" ? "±0" : amount}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Days as stacked bars, Android under Web; an SVG of its own, no chart library. */
function DayBars({
  name,
  days,
  pick,
  platform,
}: {
  name: string;
  days: readonly StatsDay[];
  pick: (day: StatsDay) => ByPlatform;
  platform: StatsPlatform;
}) {
  const values = days.map((day) => {
    const both = pick(day);
    return {
      date: day.date,
      android: platform === "web" ? 0 : both.android,
      web: platform === "android" ? 0 : both.web,
    };
  });
  const total = values.reduce((sum, day) => sum + day.android + day.web, 0);
  const top = Math.max(1, ...values.map((day) => day.android + day.web));
  if (days.length === 0) {
    return (
      <figure className="stats-chart">
        <figcaption className="stats-table__caption">{name}</figcaption>
        <p className="stats__none">{words().notCounted}</p>
      </figure>
    );
  }
  const width = 100 / values.length;
  return (
    <figure className="stats-chart">
      <figcaption className="stats-table__caption">{name}</figcaption>
      <svg
        className="stats-chart__bars"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label={fill(words().chartOf, { name, total: formatCount(total) })}
      >
        {values.map((day, index) => {
          const androidHeight = (day.android / top) * 40;
          const webHeight = (day.web / top) * 40;
          return (
            <g key={day.date}>
              <title>{`${day.date}: ${formatCount(day.android + day.web)}`}</title>
              <rect
                className="stats-chart__android"
                x={index * width + width * 0.1}
                width={width * 0.8}
                y={40 - androidHeight}
                height={androidHeight}
              />
              <rect
                className="stats-chart__web"
                x={index * width + width * 0.1}
                width={width * 0.8}
                y={40 - androidHeight - webHeight}
                height={webHeight}
              />
            </g>
          );
        })}
      </svg>
      <div className="stats-chart__axis">
        <span>{values[0]!.date}</span>
        <span>{values[values.length - 1]!.date}</span>
      </div>
      {platform === "all" && (
        <div className="stats-chart__legend">
          <span className="stats-chart__key stats-chart__key--android">{words().android}</span>
          <span className="stats-chart__key stats-chart__key--web">{words().web}</span>
        </div>
      )}
    </figure>
  );
}

function Funnel({ stats }: { stats: Statistics }) {
  const counts = new Map(stats.funnel.map((row) => [row.step, row.count]));
  const steps = FUNNEL_STEPS.filter((step) => counts.has(step));
  if (steps.length === 0) return <p className="stats__none">{words().notCounted}</p>;
  const first = counts.get(steps[0]!) || 1;
  return (
    <ol className="stats-funnel">
      {steps.map((step, index) => {
        const count = counts.get(step)!;
        const before = index === 0 ? null : counts.get(steps[index - 1]!)!;
        return (
          <li key={step} className="stats-funnel__step">
            <span className="stats-funnel__name">{words().steps[step]}</span>
            <span className="stats-funnel__bar" aria-hidden="true">
              <span style={{ inlineSize: `${Math.min(100, (count / first) * 100)}%` }} />
            </span>
            <span className="stats-funnel__count">
              {formatCount(count)}
              {before !== null && before > 0 && (
                <span className="stats-funnel__share">
                  {fill(words().ofStep, { share: percentOf(count / before) })}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="stats-block" aria-labelledby={id}>
      <h3 id={id} className="stats-block__title">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Figures({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="stats-figures">
      {rows.map((row) => (
        <div key={row.label} className="stats-figures__row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="stats__out" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="open_in_new" />
    </a>
  );
}

function Report({
  stats,
  platform,
  compare,
}: {
  stats: Statistics;
  platform: StatsPlatform;
  compare: boolean;
}) {
  const file = `tieryourlife-${stats.period.from}-${stats.period.to}`;
  const nothing =
    Object.values(stats.tiles).every((value) => value === null) &&
    stats.daily.length === 0 &&
    stats.funnel.length === 0;
  const timeText = (ms: number) => timeOf(ms);
  return (
    <>
      {nothing && <p className="admin-pane__note">{words().notCountedAll}</p>}
      {stats.period.partialToday && <p className="admin-pane__note">{words().partialToday}</p>}
      <Tiles stats={stats} compare={compare} />

      <Block title={words().activity}>
        <div className="stats-columns">
          <DayBars
            name={words().activeByDay}
            days={stats.daily}
            pick={(day) => day.active}
            platform={platform}
          />
          <DayBars
            name={words().newByDay}
            days={stats.daily}
            pick={(day) => day.newUsers}
            platform={platform}
          />
        </div>
      </Block>

      <Block title={words().funnel}>
        <p className="admin-pane__note">{words().funnelBody}</p>
        <Funnel stats={stats} />
      </Block>

      <Block title={words().retention}>
        <StatTable
          name="retention"
          file={file}
          caption={words().retention}
          hideCaption
          rows={stats.retention}
          columns={[
            { label: words().week, value: (row) => row.week },
            { label: words().cohort, value: (row) => row.size, numeric: true },
            {
              label: "D1",
              value: (row) => row.d1,
              numeric: true,
              show: (row) => shareText(row.d1),
            },
            {
              label: "D7",
              value: (row) => row.d7,
              numeric: true,
              show: (row) => shareText(row.d7),
            },
            {
              label: "D30",
              value: (row) => row.d30,
              numeric: true,
              show: (row) => shareText(row.d30),
            },
          ]}
        />
      </Block>

      <Block title={words().searches}>
        <div className="stats-columns">
          <StatTable
            name="picture-searches"
            file={file}
            caption={words().pictureSearches}
            rows={stats.pictureSearches.top}
            columns={[
              { label: words().query, value: (row) => row.q },
              { label: words().section, value: (row) => row.section ?? null },
              { label: words().count, value: (row) => row.count, numeric: true },
            ]}
          />
          <StatTable
            name="picture-searches-empty"
            file={file}
            caption={words().pictureSearchesEmpty}
            rows={stats.pictureSearches.empty}
            columns={[
              { label: words().query, value: (row) => row.q },
              { label: words().count, value: (row) => row.count, numeric: true },
            ]}
          />
          <StatTable
            name="list-searches"
            file={file}
            caption={words().listSearches}
            rows={stats.listSearches.top}
            columns={[
              { label: words().query, value: (row) => row.q },
              { label: words().count, value: (row) => row.count, numeric: true },
            ]}
          />
        </div>
        <SearchesPane embedded />
      </Block>

      <Block title={words().content}>
        <StatTable
          name="lists"
          file={file}
          caption={words().lists}
          rows={stats.lists}
          columns={[
            {
              label: words().list,
              value: (row) => row.title,
              show: (row) => <Link to={`/l/${row.id}`}>{row.title}</Link>,
            },
            { label: words().opens, value: (row) => row.opens, numeric: true },
            { label: words().copies, value: (row) => row.copies, numeric: true },
            { label: words().finished, value: (row) => row.finished, numeric: true },
            { label: words().shared, value: (row) => row.shared, numeric: true },
          ]}
        />
        <StatTable
          name="topics"
          file={file}
          caption={words().topics}
          rows={stats.topics}
          columns={[
            { label: words().topic, value: (row) => row.name },
            { label: words().section, value: (row) => row.section },
            { label: words().opens, value: (row) => row.opens, numeric: true },
            { label: words().follows, value: (row) => row.follows, numeric: true },
          ]}
        />
      </Block>

      <Block title={words().audience}>
        <Figures
          rows={[
            { label: words().guests, value: countText(stats.audience.guests) },
            { label: words().google, value: countText(stats.audience.google) },
          ]}
        />
        <div className="stats-columns">
          <StatTable
            name="languages"
            file={file}
            caption={words().languages}
            rows={stats.audience.languages}
            columns={[
              { label: words().language, value: (row) => nameOf("language", row.code) },
              { label: words().people, value: (row) => row.count, numeric: true },
            ]}
          />
          <StatTable
            name="regions"
            file={file}
            caption={words().regions}
            rows={stats.audience.regions}
            columns={[
              { label: words().region, value: (row) => nameOf("region", row.code) },
              { label: words().people, value: (row) => row.count, numeric: true },
            ]}
          />
          <StatTable
            name="versions"
            file={file}
            caption={words().versions}
            rows={stats.audience.versions}
            columns={[
              {
                label: words().platform,
                value: (row) => (row.platform === "android" ? words().android : words().web),
              },
              { label: words().version, value: (row) => row.version },
              { label: words().people, value: (row) => row.count, numeric: true },
            ]}
          />
        </div>
      </Block>

      <Block title={words().sources}>
        <StatTable
          name="referrers"
          file={file}
          caption={words().sources}
          hideCaption
          rows={stats.referrers}
          columns={[
            {
              label: words().referrer,
              value: (row) => (row.domain === "direct" ? words().direct : row.domain),
            },
            { label: words().count, value: (row) => row.count, numeric: true },
          ]}
        />
        <p className="stats__links">
          <OutLink href={PLAY_CONSOLE}>{words().playConsole}</OutLink>
          <OutLink href={SEARCH_CONSOLE}>{words().searchConsole}</OutLink>
        </p>
      </Block>

      <Block title={words().crashes}>
        <Figures
          rows={[
            { label: words().crashFreeUsers, value: shareText(stats.crashes.freeUsers) },
            { label: words().crashFreeSessions, value: shareText(stats.crashes.freeSessions) },
          ]}
        />
        <DayBars
          name={words().crashesByDay}
          days={stats.daily}
          pick={(day) => day.crashes}
          platform={platform}
        />
        <StatTable
          name="errors"
          file={file}
          caption={words().topErrors}
          rows={stats.crashes.top.filter((row) => platform === "all" || row.platform === platform)}
          columns={[
            {
              label: words().platform,
              value: (row) => (row.platform === "android" ? words().android : words().web),
            },
            { label: words().errorType, value: (row) => row.type },
            { label: words().errorPlace, value: (row) => row.place },
            { label: words().version, value: (row) => row.version },
            { label: words().count, value: (row) => row.count, numeric: true },
            { label: words().people, value: (row) => row.people, numeric: true },
            {
              label: words().firstSeen,
              value: (row) => row.firstAt,
              numeric: true,
              show: (row) => timeText(row.firstAt),
            },
            {
              label: words().lastSeen,
              value: (row) => row.lastAt,
              numeric: true,
              show: (row) => timeText(row.lastAt),
            },
          ]}
        />
        <p className="stats__links">
          <OutLink href={CRASHLYTICS}>{words().crashlytics}</OutLink>
          <OutLink href={PLAY_CONSOLE}>{words().vitals}</OutLink>
        </p>
      </Block>

      <Block title={words().server}>
        <Figures
          rows={[
            { label: words().errors5xx, value: countText(stats.server.errors5xx) },
            { label: words().appCheckRefused, value: countText(stats.server.appCheckRefused) },
            { label: words().catalogueBusy, value: countText(stats.server.catalogueBusy) },
            { label: words().searchLimit, value: countText(stats.server.searchLimit) },
            { label: words().serper, value: countText(stats.costs.serper) },
            { label: words().vision, value: countText(stats.costs.vision) },
          ]}
        />
      </Block>

      {stats.updatedAt !== null && (
        <p className="admin-pane__note">
          {fill(words().updatedAt, { time: timeOf(stats.updatedAt) })}
        </p>
      )}
    </>
  );
}

/**
 * The owner's Statistics (Marketing's proposal, 20.11.2026, section 3): the
 * period and platform on top, six figures against the period before, then
 * activity, the newcomers' funnel, retention, searches (the empty-searches
 * pane among them), content, audience, sources, crashes and the server. Every
 * figure is an anonymous daily total the backend keeps; one it does not count
 * yet says so instead of a number.
 */
export function StatisticsPane({
  load = loadStatistics,
  now = Date.now,
}: {
  load?: (query: StatsQuery) => Promise<Statistics>;
  now?: () => number;
}) {
  const [period, setPeriod] = useState<Period>("30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [platform, setPlatform] = useState<StatsPlatform>("all");
  const [compare, setCompare] = useState(true);
  const range = rangeOf(period, now(), custom);
  const key = range === null ? "" : JSON.stringify({ ...range, platform });
  const loadKey = useCallback(
    (asked: string) =>
      asked === "" ? new Promise<Statistics>(() => {}) : load(JSON.parse(asked) as StatsQuery),
    [load],
  );
  const { state, retry } = useResource(key, loadKey);
  const platformId = useId();
  return (
    <section className="admin-pane stats" aria-labelledby="admin-statistics">
      <header className="admin-pane__head">
        <h2 id="admin-statistics" className="admin-pane__title">
          {words().title}
        </h2>
        <p className="admin-pane__count">{words().body}</p>
      </header>
      <div className="stats-controls">
        <div className="admin-pane__chips" role="group" aria-label={words().period}>
          {PERIODS.map((each) => (
            <Chip key={each} selected={period === each} onClick={() => setPeriod(each)}>
              {periodLabel(each)}
            </Chip>
          ))}
        </div>
        {period === "custom" && (
          <div className="stats-controls__dates">
            <label className="field">
              <span className="field__label">{words().from}</span>
              <input
                type="date"
                value={custom.from}
                onChange={(event) =>
                  setCustom((before) => ({ ...before, from: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span className="field__label">{words().to}</span>
              <input
                type="date"
                value={custom.to}
                onChange={(event) => setCustom((before) => ({ ...before, to: event.target.value }))}
              />
            </label>
          </div>
        )}
        <label className="field admin-pane__select" htmlFor={platformId}>
          <span className="field__label">{words().platform}</span>
          <select
            id={platformId}
            value={platform}
            onChange={(event) => setPlatform(event.target.value as StatsPlatform)}
          >
            <option value="all">{words().allPlatforms}</option>
            <option value="android">{words().android}</option>
            <option value="web">{words().web}</option>
          </select>
        </label>
        <label className="stats-controls__compare">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          <span>{words().compare}</span>
        </label>
      </div>
      {range === null ? null : state.status === "loading" ? (
        <PaneLoading />
      ) : state.status === "error" ? (
        <div className="admin__trouble" role="alert">
          <p>{words().failed}</p>
          <Button variant="tonal" icon="refresh" onClick={retry}>
            {strings.feed.tryAgain}
          </Button>
        </div>
      ) : (
        <Report stats={state.value} platform={platform} compare={compare} />
      )}
    </section>
  );
}
