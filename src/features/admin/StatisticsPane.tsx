import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  FUNNEL_STEPS,
  type Counted,
  type Statistics,
  type StatsDay,
  type StatsPlatform,
  type StatsQuery,
  type TileName,
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

// Where the backend's links point, should an answer come without them.
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

const countText = (value: Counted): string =>
  value === null ? "—" : formatCount(Math.round(value));
const shareText = (value: Counted): string => (value === null ? "—" : percentOf(value));

function nameOf(type: "language" | "region", code: string): string {
  try {
    return new Intl.DisplayNames([currentLocale()], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

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

/** A table of one block: sorted by any column, saved as CSV, or saying why it is empty. */
function StatTable<Row>({
  name,
  caption,
  columns,
  rows,
  file,
  hideCaption = false,
  none = words().notCounted,
}: {
  name: string;
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  file: string;
  /** The block's own title already says it; the table keeps it as its name. */
  hideCaption?: boolean;
  /** What an empty table says. */
  none?: string;
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
        <p className="stats__none">{none}</p>
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

/**
 * The six figures on top. Those the apps count (all but Published) stay 0
 * until the apps send their batches (CONTRACT.md, Usage statistics): shown
 * as "—", needing the new app, rather than as a fall to nothing.
 */
const TILES: { key: TileName; label: () => string; share: boolean; fromApps: boolean }[] = [
  { key: "mau", label: () => words().mau, share: false, fromApps: true },
  { key: "dauAverage", label: () => words().dauAverage, share: false, fromApps: true },
  { key: "newcomers", label: () => words().newUsers, share: false, fromApps: true },
  { key: "d7", label: () => words().d7, share: true, fromApps: true },
  { key: "published", label: () => words().published, share: false, fromApps: false },
  { key: "crashFreeUsers", label: () => words().crashFree, share: true, fromApps: true },
];

/** Below 99.5% the crash-free tile turns red: a bad release shows the same day. */
const CRASH_FREE_FLOOR = 0.995;

/** Nothing has come from the apps yet: no active device in the period. */
const appsSilent = (stats: Statistics): boolean =>
  stats.daily.every((day) => day.active === 0) && (stats.tiles.mau.value ?? 0) === 0;

function Tiles({ stats, compare }: { stats: Statistics; compare: boolean }) {
  const silent = appsSilent(stats);
  return (
    <ul className="stats-tiles">
      {TILES.map(({ key, label, share, fromApps }) => {
        const tile = stats.tiles[key];
        const waiting = fromApps && silent;
        const value = waiting ? null : tile.value;
        const change =
          compare && !waiting && stats.compared ? changeOf(value, tile.previous, share) : null;
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
            {waiting ? (
              <span className="stats-tile__change">{words().needsApp}</span>
            ) : (
              change !== null && (
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
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface Series {
  name: string;
  className: string;
}

/** Days as stacked bars, an SVG of its own with no chart library; one part per series. */
function DayBars({
  name,
  days,
  series,
  parts,
  none = words().notCounted,
}: {
  name: string;
  days: readonly StatsDay[];
  series: readonly Series[];
  parts: (day: StatsDay) => number[];
  none?: string;
}) {
  const values = days.map((day) => ({ day: day.day, parts: parts(day) }));
  const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);
  const total = sum(values.map((day) => sum(day.parts)));
  if (days.length === 0 || total === 0) {
    return (
      <figure className="stats-chart">
        <figcaption className="stats-table__caption">{name}</figcaption>
        <p className="stats__none">{none}</p>
      </figure>
    );
  }
  const top = Math.max(1, ...values.map((day) => sum(day.parts)));
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
          let base = 40;
          return (
            <g key={day.day}>
              <title>{`${day.day}: ${formatCount(sum(day.parts))}`}</title>
              {day.parts.map((part, at) => {
                const height = (part / top) * 40;
                base -= height;
                return (
                  <rect
                    key={series[at]?.className ?? at}
                    className={series[at]?.className}
                    x={index * width + width * 0.1}
                    width={width * 0.8}
                    y={base}
                    height={height}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="stats-chart__axis">
        <span>{values[0]!.day}</span>
        <span>{values[values.length - 1]!.day}</span>
      </div>
      {series.length > 1 && (
        <div className="stats-chart__legend">
          {series.map((one) => (
            <span key={one.className} className={`stats-chart__key ${one.className}`}>
              {one.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

function Funnel({ stats }: { stats: Statistics }) {
  const counts = new Map(stats.funnel.map((row) => [row.step, row.n]));
  const steps = FUNNEL_STEPS.filter((step) => counts.has(step));
  if (steps.every((step) => (counts.get(step) ?? 0) === 0)) {
    return <p className="stats__none">{words().needsApp}</p>;
  }
  const first = Math.max(1, ...steps.map((step) => counts.get(step)!));
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

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="stats-block" aria-labelledby={id}>
      <h3 id={id} className="stats-block__title">
        {title}
      </h3>
      {note !== undefined && <p className="admin-pane__note">{note}</p>}
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

interface SearchRow {
  q: string;
  section: string | null;
  n: number;
  miss: number;
}

const searchColumns = (withSection: boolean): Column<SearchRow>[] => [
  { label: words().query, value: (row) => row.q },
  ...(withSection ? [{ label: words().section, value: (row: SearchRow) => row.section }] : []),
  { label: words().count, value: (row) => row.n, numeric: true },
  { label: words().misses, value: (row) => row.miss, numeric: true },
];

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
  const silent = appsSilent(stats);
  const total = (event: string) => (event in stats.totals ? stats.totals[event]! : null);
  const split = platform === "all" && stats.daily.some((day) => day.activeAndroid !== null);
  const features = Object.entries(stats.totals)
    .filter(([event]) => event.startsWith("f."))
    .map(([event, n]) => ({ name: event.slice(2), n }));
  const accounts = stats.audience.accounts;
  const links = {
    crashlytics: stats.links.crashlytics ?? CRASHLYTICS,
    playConsole: stats.links.playConsole ?? PLAY_CONSOLE,
    searchConsole: stats.links.searchConsole ?? SEARCH_CONSOLE,
  };
  return (
    <>
      {stats.period.todayIsPartial && <p className="admin-pane__note">{words().partialToday}</p>}
      <Tiles stats={stats} compare={compare} />

      <Block title={words().activity} note={silent ? words().needsAppNote : undefined}>
        {!silent && (
          <Figures
            rows={[
              {
                label: fill(words().dauOn, { day: stats.period.to }),
                value: countText(stats.rolling.dau),
              },
              { label: words().wau, value: countText(stats.rolling.wau) },
              { label: words().mau, value: countText(stats.rolling.mau) },
            ]}
          />
        )}
        <div className="stats-columns">
          <DayBars
            name={words().activeByDay}
            days={stats.daily}
            none={words().needsApp}
            series={
              split
                ? [
                    { name: words().android, className: "stats-chart__android" },
                    { name: words().web, className: "stats-chart__web" },
                  ]
                : [{ name: words().activeByDay, className: "stats-chart__android" }]
            }
            parts={(day) => (split ? [day.activeAndroid ?? 0, day.activeWeb ?? 0] : [day.active])}
          />
          <DayBars
            name={words().newByDay}
            days={stats.daily}
            none={words().needsApp}
            series={[{ name: words().newByDay, className: "stats-chart__android" }]}
            parts={(day) => [day.newcomers]}
          />
        </div>
      </Block>

      <Block title={words().funnel} note={words().funnelBody}>
        <Funnel stats={stats} />
      </Block>

      <Block title={words().retention} note={words().perInstall}>
        <StatTable
          name="retention"
          file={file}
          caption={words().retention}
          hideCaption
          none={words().needsApp}
          rows={stats.retention.filter((row) => row.size > 0)}
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

      <Block title={words().searches} note={words().searchesNote}>
        <Figures
          rows={[
            { label: words().pictureSearches, value: countText(total("search.pictures")) },
            {
              label: words().pictureSearchesEmpty,
              value: countText(total("search.pictures.miss")),
            },
            { label: words().listSearches, value: countText(total("search.lists")) },
            { label: words().listSearchesEmpty, value: countText(total("search.lists.miss")) },
          ]}
        />
        <div className="stats-columns">
          <StatTable
            name="picture-searches"
            file={file}
            caption={words().pictureSearches}
            rows={stats.top.pictureSearch}
            columns={searchColumns(true)}
          />
          <StatTable
            name="picture-misses"
            file={file}
            caption={words().pictureSearchesEmpty}
            rows={stats.top.pictureMisses}
            columns={searchColumns(true)}
          />
          <StatTable
            name="list-searches"
            file={file}
            caption={words().listSearches}
            rows={stats.top.listSearch}
            columns={searchColumns(false)}
          />
          <StatTable
            name="list-misses"
            file={file}
            caption={words().listSearchesEmpty}
            rows={stats.top.listMisses}
            columns={searchColumns(false)}
          />
        </div>
        <SearchesPane embedded />
      </Block>

      <Block title={words().content} note={words().approximate}>
        <StatTable
          name="lists"
          file={file}
          caption={words().lists}
          rows={stats.top.lists}
          columns={[
            {
              label: words().list,
              value: (row) => row.title ?? row.id,
              show: (row) => <Link to={`/l/${row.id}`}>{row.title ?? row.id}</Link>,
            },
            { label: words().opens, value: (row) => row.views, numeric: true },
            { label: words().copies, value: (row) => row.takes, numeric: true },
          ]}
        />
        <div className="stats-columns">
          <StatTable
            name="topics"
            file={file}
            caption={words().topics}
            rows={stats.top.topics}
            columns={[
              { label: words().topic, value: (row) => row.name ?? row.id },
              { label: words().opens, value: (row) => row.opens, numeric: true },
              { label: words().follows, value: (row) => row.follows, numeric: true },
            ]}
          />
          <StatTable
            name="sections"
            file={file}
            caption={words().sections}
            rows={stats.top.sections}
            columns={[
              { label: words().section, value: (row) => row.id },
              { label: words().opens, value: (row) => row.opens, numeric: true },
            ]}
          />
        </div>
        <StatTable
          name="features"
          file={file}
          caption={words().features}
          none={words().needsApp}
          rows={features}
          columns={[
            { label: words().feature, value: (row) => row.name },
            { label: words().count, value: (row) => row.n, numeric: true },
          ]}
        />
      </Block>

      <Block title={words().audience}>
        <StatTable
          name="accounts"
          file={file}
          caption={
            accounts?.asOf
              ? fill(words().accountsAsOf, { day: accounts.asOf.slice(0, 10) })
              : words().accounts
          }
          none={words().accountsNone}
          rows={
            accounts === null
              ? []
              : [
                  { kind: words().guests, ...accounts.guests },
                  { kind: words().google, ...accounts.google },
                ]
          }
          columns={[
            { label: words().accounts, value: (row) => row.kind },
            { label: words().total, value: (row) => row.total, numeric: true },
            { label: words().new1, value: (row) => row.new1, numeric: true },
            { label: words().active1, value: (row) => row.active1, numeric: true },
            { label: words().active7, value: (row) => row.active7, numeric: true },
            { label: words().active30, value: (row) => row.active30, numeric: true },
          ]}
        />
        {accounts !== null && !accounts.complete && (
          <p className="admin-pane__note">{words().accountsIncomplete}</p>
        )}
        <div className="stats-columns">
          <StatTable
            name="languages"
            file={file}
            caption={words().languages}
            none={words().needsApp}
            rows={stats.audience.languages}
            columns={[
              { label: words().language, value: (row) => nameOf("language", row.value) },
              { label: words().people, value: (row) => row.n, numeric: true },
            ]}
          />
          <StatTable
            name="regions"
            file={file}
            caption={words().regions}
            none={words().needsApp}
            rows={stats.audience.regions}
            columns={[
              { label: words().region, value: (row) => nameOf("region", row.value) },
              { label: words().people, value: (row) => row.n, numeric: true },
            ]}
          />
          <StatTable
            name="versions"
            file={file}
            caption={words().versions}
            none={words().needsApp}
            rows={stats.audience.versions}
            columns={[
              { label: words().version, value: (row) => row.value },
              { label: words().people, value: (row) => row.n, numeric: true },
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
          none={words().needsApp}
          rows={stats.top.referrers}
          columns={[
            {
              label: words().referrer,
              value: (row) => (row.domain === "" ? words().direct : row.domain),
            },
            { label: "utm_source", value: (row) => row.utm },
            { label: words().count, value: (row) => row.n, numeric: true },
          ]}
        />
        <p className="stats__links">
          <OutLink href={links.playConsole}>{words().playConsole}</OutLink>
          <OutLink href={links.searchConsole}>{words().searchConsole}</OutLink>
        </p>
      </Block>

      <Block title={words().crashes}>
        <Figures
          rows={[
            {
              label: words().crashFreeUsers,
              value: silent ? "—" : shareText(stats.tiles.crashFreeUsers.value),
            },
            {
              label: words().crashFreeSessions,
              value: silent ? "—" : shareText(stats.tiles.crashFreeSessions.value),
            },
          ]}
        />
        <DayBars
          name={words().crashesByDay}
          days={stats.daily}
          none={silent ? words().needsApp : words().noCrashes}
          series={[{ name: words().crashesByDay, className: "stats-chart__crash" }]}
          parts={(day) => [day.crashedSessions]}
        />
        <StatTable
          name="errors"
          file={file}
          caption={words().topErrors}
          none={silent ? words().needsApp : words().noCrashes}
          rows={stats.top.crashes}
          columns={[
            { label: words().errorType, value: (row) => row.type },
            { label: words().errorPlace, value: (row) => row.place },
            { label: words().version, value: (row) => row.version },
            { label: words().count, value: (row) => row.n, numeric: true },
            { label: words().firstSeen, value: (row) => row.first },
            { label: words().lastSeen, value: (row) => row.last },
          ]}
        />
        <p className="stats__links">
          <OutLink href={links.crashlytics}>{words().crashlytics}</OutLink>
          <OutLink href={links.playConsole}>{words().vitals}</OutLink>
        </p>
      </Block>

      <Block title={words().server} note={words().approximate}>
        <Figures
          rows={[
            { label: words().errors5xx, value: countText(total("server.5xx")) },
            { label: words().appCheckRefused, value: countText(total("server.appCheckRefused")) },
            { label: words().searchLimit, value: countText(total("server.searchLimit")) },
            { label: words().catalogueBusy, value: countText(total("server.sourceBusy")) },
            { label: words().sourcesDown, value: countText(total("server.sourcesDown")) },
            { label: words().accountErased, value: countText(total("account.erased")) },
          ]}
        />
      </Block>
    </>
  );
}

/**
 * The owner's Statistics (Marketing's proposal, 20.11.2026, section 3; the
 * backend's `GET /lists/admin/stats`): the period and platform on top, six
 * figures against the period before, then activity, the newcomers' funnel,
 * retention, searches (the empty-searches pane among them), content,
 * audience, sources, crashes and the server. Every figure is an anonymous
 * daily sum; one the apps do not send yet says it needs the new app.
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
