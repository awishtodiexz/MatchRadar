import { useId, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';
import { formatMinute } from '../presentation';
import { FootballIcon } from './MatchEvents';
import { isCard, isGoal } from './matchEventKinds';
import { Badge } from './WidgetUi';

const groups = ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Other positions'] as const;
type Group = (typeof groups)[number];

export function positionGroup(position: string): Group {
  const code = position.trim().toUpperCase().replace(/\s+/g, '').split('-')[0];
  if (['G', 'GK', 'GOALKEEPER'].includes(code)) return 'Goalkeepers';
  if (/^(D|DF|DEF|CB|CD|LB|RB|LWB|RWB|SW)$/.test(code)) return 'Defenders';
  if (/^(M|MF|MID|CM|DM|AM|LM|RM|CDM|CAM|AML|AMR)$/.test(code)) return 'Midfielders';
  if (/^(F|FW|ST|CF|SS|LW|RW)$/.test(code)) return 'Forwards';
  return 'Other positions';
}
const POSITION_NAMES: Record<string, string> = {
  G: 'Goalkeeper',
  GK: 'Goalkeeper',
  D: 'Defender',
  DF: 'Defender',
  CB: 'Centre-back',
  CD: 'Centre-back',
  LB: 'Left-back',
  RB: 'Right-back',
  LWB: 'Left wing-back',
  RWB: 'Right wing-back',
  SW: 'Sweeper',
  M: 'Midfielder',
  MF: 'Midfielder',
  CM: 'Central midfielder',
  DM: 'Defensive midfielder',
  CDM: 'Defensive midfielder',
  AM: 'Attacking midfielder',
  CAM: 'Attacking midfielder',
  LM: 'Left midfielder',
  RM: 'Right midfielder',
  AML: 'Left attacking midfielder',
  AMR: 'Right attacking midfielder',
  F: 'Forward',
  FW: 'Forward',
  ST: 'Striker',
  CF: 'Centre-forward',
  SS: 'Second striker',
  LW: 'Left winger',
  RW: 'Right winger',
};
/** "CD-R" → "Centre-back (right)"; unknown codes have no expansion. */
export function positionName(position: string): string | undefined {
  const [code, side] = position.trim().toUpperCase().replace(/\s+/g, '').split('-');
  const name = POSITION_NAMES[code];
  if (!name) return undefined;
  return side === 'L' ? `${name} (left)` : side === 'R' ? `${name} (right)` : side === 'C' ? `${name} (centre)` : name;
}
function Position({ position }: { position: string }) {
  const name = positionName(position);
  return name && name.toUpperCase() !== position.trim().toUpperCase() ? (
    <abbr title={name}>{position}</abbr>
  ) : (
    <>{position}</>
  );
}
const byPlace = (a: MatchSummary['players'][number], b: MatchSummary['players'][number]) =>
  (a.formationPlace ?? 99) - (b.formationPlace ?? 99) || a.name.localeCompare(b.name);
type PitchData = { lines: MatchSummary['players'][]; keeper: MatchSummary['players'][number]; formation: string };
const positionCode = (position: string) => position.trim().toUpperCase().replace(/\s+/g, '');
const lateralOrder = (position: string) => {
  const code = positionCode(position);
  if (/^(LB|LWB|LM|LW|AML)$/.test(code)) return 0;
  if (/^(RB|RWB|RM|RW|AMR)$/.test(code)) return 4;
  if (/-L$/.test(code)) return 1;
  if (/-R$/.test(code)) return 3;
  return 2;
};

function pitchLabel(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  let surnameStart = words.length - 1;
  while (
    surnameStart > 1 &&
    /^(de|del|da|das|do|dos|di|van|von|der|den|la|le|el|al|bin|ben)$/i.test(words[surnameStart - 1])
  )
    surnameStart--;
  return `${words[0][0]}. ${words.slice(surnameStart).join(' ')}`;
}

function buildPitch(players: MatchSummary['players'], formation?: string): PitchData | null {
  const xi = players.filter((player) => player.starter).sort(byPlace);
  const shape = (formation ?? '').split('-').map(Number);
  if (
    xi.length !== 11 ||
    xi.some(
      (player) =>
        !Number.isInteger(player.formationPlace) ||
        !player.formationPlace ||
        player.formationPlace < 1 ||
        player.formationPlace > 11,
    ) ||
    new Set(xi.map((player) => player.formationPlace)).size !== 11 ||
    !formation ||
    shape.length < 2 ||
    shape.some((n) => !Number.isInteger(n) || n < 1) ||
    shape.reduce((sum, n) => sum + n, 0) !== 10
  )
    return null;
  const keeper = xi.find((player) => positionGroup(player.position) === 'Goalkeepers');
  if (!keeper) return null;
  // ESPN's formationPlace is a slot identifier, not back-to-front order.
  // Use the supplied position to group lines before applying the formation.
  const band = (position: string) => {
    const code = positionCode(position);
    if (positionGroup(code) === 'Defenders') return 1;
    if (/^(DM|CDM)/.test(code)) return 2;
    if (/^(AM|CAM|LW|RW)/.test(code)) return 4;
    return positionGroup(code) === 'Forwards' ? 5 : 3;
  };
  const outfield = xi
    .filter((player) => player !== keeper)
    .sort((a, b) => band(a.position) - band(b.position) || byPlace(a, b));
  let cursor = 0;
  const lines = shape.map((count) => {
    const line = outfield.slice(cursor, cursor + count);
    cursor += count;
    return line.sort((a, b) => lateralOrder(a.position) - lateralOrder(b.position) || byPlace(a, b));
  });
  return cursor === 10 ? { lines, keeper, formation } : null;
}

type Player = MatchSummary['players'][number];
type Sub = NonNullable<MatchSummary['substitutions']>[number];
export interface PlayerMarks {
  goals: number;
  yellow: number;
  red: boolean;
  off?: string;
  notes: string[];
}

/** Goals, cards and the substitution that took a player off, from the event feed. */
export function playerMarks(name: string, teamId: string, events: MatchSummary['events'], subs: Sub[]): PlayerMarks {
  const marks: PlayerMarks = { goals: 0, yellow: 0, red: false, notes: [] };
  for (const event of events) {
    if (event.participants?.[0] !== name || (event.teamId && event.teamId !== teamId)) continue;
    const minute = formatMinute(event.minute);
    if (isGoal(event.kind)) {
      marks.goals++;
      marks.notes.push(`Goal ${minute}`);
    } else if (isCard(event.kind)) {
      if (/red|second-yellow/i.test(event.kind)) {
        marks.red = true;
        marks.notes.push(`Red card ${minute}`);
      } else {
        marks.yellow++;
        marks.notes.push(`Yellow card ${minute}`);
      }
    }
  }
  const off = subs.find((sub) => sub.playerOut === name);
  if (off) {
    marks.off = off.minute;
    marks.notes.push(`Subbed off ${formatMinute(off.minute)}`);
  }
  return marks;
}

function LineupPitch({
  team,
  pitch,
  marksFor,
}: {
  team: Match['home'];
  pitch: PitchData;
  marksFor: (name: string) => PlayerMarks;
}) {
  const [inspected, setInspected] = useState<Player | null>(null);
  const inspectionId = useId();
  const lines = [...pitch.lines].reverse().concat([[pitch.keeper]]);
  return (
    <div
      className="lineup-pitch"
      role="group"
      aria-label={`${team.name} starting XI at kickoff`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setInspected(null);
          event.stopPropagation();
        }
      }}
    >
      <span className="pitch-halfway" aria-hidden="true" />
      <span className="pitch-circle" aria-hidden="true" />
      <span className="pitch-box pitch-box-top" aria-hidden="true" />
      <span className="pitch-box pitch-box-bottom" aria-hidden="true" />
      {lines.map((line, index) => (
        <div className="pitch-row" key={index}>
          {line.map((player) => {
            const marks = marksFor(player.name);
            const label = `${team.name} · #${player.jersey || '–'} ${player.name}${marks.notes.length ? ` · ${marks.notes.join(', ')}` : ''}`;
            return (
              <button
                type="button"
                className="pitch-player"
                key={player.formationPlace}
                title={label}
                aria-label={label}
                aria-describedby={inspected === player ? inspectionId : undefined}
                onFocus={() => setInspected(player)}
                onClick={() => setInspected(player)}
                onBlur={() => setInspected(null)}
              >
                <span className="pitch-shirt-wrap" aria-hidden="true">
                  <span className={'pitch-shirt ' + (player === pitch.keeper ? 'is-keeper' : '')}>
                    {player.jersey || '–'}
                  </span>
                  {marks.goals > 0 && (
                    <span className="pitch-badge badge-goal">
                      <FootballIcon size={13} />
                      {marks.goals > 1 && <b>{marks.goals}</b>}
                    </span>
                  )}
                  {(marks.yellow > 0 || marks.red) && (
                    <span className="pitch-badge badge-cards">
                      {marks.yellow > 0 && <i className="card-yellow" />}
                      {marks.red && <i className="card-red" />}
                    </span>
                  )}
                  {marks.off && (
                    <span className="pitch-badge badge-off">
                      <ArrowDown size={11} strokeWidth={2.5} />
                      <span>{formatMinute(marks.off)}</span>
                    </span>
                  )}
                </span>
                <span className="pitch-name" aria-hidden="true">
                  {pitchLabel(player.name)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {inspected && (
        <div className="pitch-inspection" id={inspectionId}>
          <strong>{inspected.name}</strong>
          <span>
            #{inspected.jersey || '–'} · {inspected.position || 'Position unavailable'}
            {marksFor(inspected.name)
              .notes.map((note) => ` · ${note}`)
              .join('')}
          </span>
        </div>
      )}
    </div>
  );
}

/** Order of introduction: "90'+7'" sorts after "90'". */
const minuteOrder = (minute: string) => {
  const match = /(\d+)(?:\D+(\d+))?/.exec(minute);
  return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : Infinity;
};
const jerseyOrder = (player: { jersey?: string | null }) => {
  const n = Number.parseInt(player.jersey ?? '', 10);
  return Number.isFinite(n) ? n : Infinity;
};
export interface BenchRow {
  key: string;
  name: string;
  jersey?: string | null;
  position: string;
  on?: Sub;
  off?: Sub;
  used: boolean;
}

/** Used substitutes first in the order they came on, then the unused ones by shirt number. */
export function benchRows(substitutes: Player[], subs: Sub[], squad: Player[] = substitutes): BenchRow[] {
  const rows: BenchRow[] = substitutes.map((player, index) => {
    const on = subs.find((sub) => sub.playerIn === player.name);
    return {
      key: `${player.name}-${index}`,
      name: player.name,
      jersey: player.jersey,
      position: /^sub$/i.test(player.position.trim()) ? '' : player.position,
      on,
      off: subs.find((sub) => sub.playerOut === player.name),
      used: !!on || !!player.subbedIn,
    };
  });
  // A substitution whose player is missing from the squad list must not vanish with the old Substitutions section.
  for (const sub of subs)
    if (!squad.some((player) => player.name === sub.playerIn))
      rows.push({
        key: `sub-${sub.minute}-${sub.playerIn}`,
        name: sub.playerIn,
        position: '',
        on: sub,
        off: subs.find((other) => other.playerOut === sub.playerIn),
        used: true,
      });
  const rank = (row: BenchRow) => (row.on ? 0 : row.used ? 1 : 2);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? minuteOrder(a.on!.minute) - minuteOrder(b.on!.minute) : 0) ||
      (rank(a) === 2 ? jerseyOrder(a) - jerseyOrder(b) : 0) ||
      a.name.localeCompare(b.name),
  );
}

function PlayerEventNotes({ marks }: { marks: PlayerMarks }) {
  const notes = marks.notes.filter((note) => !note.startsWith('Subbed off'));
  return notes.length ? <span className="player-event-notes">{notes.join(' · ')}</span> : null;
}

function PlayerList({
  players,
  substitutions,
  marksFor,
}: {
  players: MatchSummary['players'];
  substitutions: NonNullable<MatchSummary['substitutions']>;
  marksFor: (name: string) => PlayerMarks;
}) {
  return (
    <>
      {groups.map((group) => {
        const list = players.filter((player) => positionGroup(player.position) === group).sort(byPlace);
        return list.length ? (
          <div className="lineup-group" key={group}>
            <h5>{group}</h5>
            <ul className="lineup-list">
              {list.map((player, index) => {
                const on = substitutions.find((sub) => sub.playerIn === player.name);
                const off = substitutions.find((sub) => sub.playerOut === player.name);
                return (
                  <li key={`${player.name}-${index}`}>
                    {player.jersey && <span className="jersey">#{player.jersey}</span>}
                    <span>
                      {player.name}
                      <PlayerEventNotes marks={marksFor(player.name)} />
                    </span>
                    <small>
                      <Position position={player.position} />
                      {off && (
                        <span className="sub-marker off" title={`Substituted off at ${formatMinute(off.minute)}`}>
                          {' '}
                          ↓ {formatMinute(off.minute)}
                        </span>
                      )}
                      {on && (
                        <span className="sub-marker on" title={`Substituted on at ${formatMinute(on.minute)}`}>
                          {' '}
                          ↑ {formatMinute(on.minute)}
                        </span>
                      )}
                      {!on && !off && player.subbedOut ? ' · off' : !on && !off && player.subbedIn ? ' · on' : ''}
                    </small>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null;
      })}
    </>
  );
}

function BenchList({ rows, marksFor }: { rows: BenchRow[]; marksFor: (name: string) => PlayerMarks }) {
  return (
    <ul className="lineup-list bench-list">
      {rows.map((row) => (
        <li key={row.key} className={row.used ? undefined : 'is-unused'}>
          {row.jersey && <span className="jersey">#{row.jersey}</span>}
          <span className="bench-name">
            {row.name}
            {row.on && <small className="sub-for">for {row.on.playerOut}</small>}
            <PlayerEventNotes marks={marksFor(row.name)} />
          </span>
          <small>
            <Position position={row.position} />
            {row.on && (
              <span className="sub-marker on" title={`Substituted on at ${formatMinute(row.on.minute)}`}>
                ↑ {formatMinute(row.on.minute)}
              </span>
            )}
            {!row.on && row.used && ' · on'}
            {row.off && (
              <span className="sub-marker off" title={`Substituted off at ${formatMinute(row.off.minute)}`}>
                ↓ {formatMinute(row.off.minute)}
              </span>
            )}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function MatchLineups({
  match,
  players,
  substitutions = [],
  formations = {},
  coaches = [],
  events = [],
  selection,
}: {
  match: Match;
  players: MatchSummary['players'];
  substitutions?: MatchSummary['substitutions'];
  formations?: Record<string, string>;
  coaches?: MatchSummary['coaches'];
  events?: MatchSummary['events'];
  selection?: { teamId: string | null; onChange: (teamId: string) => void };
}) {
  const sectionId = useId();
  const teams = [match.home, match.away];
  const [teamId, setTeamId] = useState<string | null>(null);
  const totals = Object.fromEntries(
    teams.map((team) => [team.id, players.filter((player) => player.teamId === team.id).length]),
  );
  const activeId =
    (selection ? selection.teamId : teamId) ??
    (totals[match.home.id] ? match.home.id : totals[match.away.id] ? match.away.id : match.home.id);
  const active = teams.find((team) => team.id === activeId) ?? match.home;
  const selected = players.filter((player) => player.teamId === active.id);
  const starters = selected.filter((player) => player.starter);
  const substitutes = selected.filter((player) => !player.starter);
  const formation = formations[active.id];
  const pitch = buildPitch(selected, formation);
  const playerTeam = (name: string) => players.find((player) => player.name === name)?.teamId;
  // ESPN sometimes omits the team on a substitution; infer it from the players
  // instead of showing the same substitution under both teams.
  const teamSubs = substitutions.filter(
    (sub) => (sub.teamId || playerTeam(sub.playerIn) || playerTeam(sub.playerOut)) === active.id,
  );
  const coachNames = coaches
    .filter((coach) => coach.teamId === active.id && coach.name.trim())
    .map((coach) => coach.name);
  const lineupCount = (id: string) =>
    totals[id] ? `${totals[id]} ${totals[id] === 1 ? 'player' : 'players'}` : 'No lineup';
  const bench = benchRows(substitutes, teamSubs, selected);
  const usedBench = bench.filter((row) => row.used);
  const unusedBench = bench.filter((row) => !row.used);
  const marksFor = (name: string) => playerMarks(name, active.id, events, teamSubs);
  const lineupRef = useRef<HTMLDivElement>(null);
  const selectTeam = (id: string) => {
    if (id === active.id) return;
    if (selection) selection.onChange(id);
    else setTeamId(id);
    requestAnimationFrame(() => {
      const body = lineupRef.current?.closest<HTMLElement>('.detail-body');
      const centre = lineupRef.current?.closest<HTMLElement>('.match-centre');
      if (body && centre)
        body.scrollTo({ top: body.scrollTop + centre.getBoundingClientRect().top - body.getBoundingClientRect().top });
    });
  };
  return (
    <div className="lineups" ref={lineupRef}>
      <div className="lineup-tabs" role="tablist" aria-label="Lineups by team">
        {teams.map((team) => (
          <button
            key={team.id}
            role="tab"
            id={sectionId + '-tab-' + team.id}
            aria-selected={active.id === team.id}
            aria-controls={sectionId + '-panel'}
            tabIndex={active.id === team.id ? 0 : -1}
            className="lineup-tab"
            title={`${team.name} · ${lineupCount(team.id)}`}
            onClick={() => selectTeam(team.id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const current = Math.max(
                0,
                teams.findIndex((team) => team.id === active.id),
              );
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? teams.length - 1
                    : event.key === 'ArrowRight'
                      ? (current + 1) % teams.length
                      : (current + teams.length - 1) % teams.length;
              const next = teams[nextIndex];
              selectTeam(next.id);
              document.getElementById(sectionId + '-tab-' + next.id)?.focus();
            }}
          >
            <Badge team={team} />
            <span className="lineup-team-name">{team.name}</span>
            <small className={totals[team.id] ? 'sr-only' : undefined}>{lineupCount(team.id)}</small>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={sectionId + '-panel'} aria-labelledby={sectionId + '-tab-' + active.id} tabIndex={0}>
        {/* Without a pitch the selected team tab already names the side; the list has its own Starting XI heading. */}
        {pitch && (
          <div className="lineup-heading">
            <h3>Starting XI</h3>
            {pitch && <small className="kickoff-note">at kickoff</small>}
            {formation && <span className="formation">{formation}</span>}
          </div>
        )}
        {coachNames.length > 0 && (
          <div className="coach-row">
            <span>{coachNames.length === 1 ? 'Coach' : 'Coaches'}</span>
            <strong>{coachNames.join(', ')}</strong>
          </div>
        )}
        {pitch && (
          <>
            <LineupPitch key={active.id} team={active} pitch={pitch} marksFor={marksFor} />
            <details className="lineup-help">
              <summary>About this lineup</summary>
              <p>Starting positions, not a live tactical view. Tap or focus a player for details.</p>
              <p>Ball = goal · cards = bookings · down arrow = substituted off</p>
            </details>
          </>
        )}
        {!pitch && starters.length === 11 && <p className="field-note">Formation unavailable for this lineup.</p>}
        {!selected.length && <p className="field-note">Lineup unavailable</p>}
        {starters.length > 0 &&
          (pitch ? (
            <details className="lineup-roster" key={active.id}>
              <summary>
                Full starting XI <small>{starters.length} players</small>
              </summary>
              <PlayerList players={starters} substitutions={teamSubs} marksFor={marksFor} />
            </details>
          ) : (
            <>
              <h4>
                Starting XI <small className="kickoff-note">at kickoff</small>
                {formation && <span className="formation">{formation}</span>}
              </h4>
              <PlayerList players={starters} substitutions={teamSubs} marksFor={marksFor} />
            </>
          ))}
        {starters.length === 0 && selected.length > 0 && (
          <>
            <h4>Squad</h4>
            <PlayerList players={selected} substitutions={teamSubs} marksFor={marksFor} />
          </>
        )}
        {bench.length > 0 && (
          <>
            <h4>Substitutes</h4>
            {usedBench.length > 0 && (
              <>
                <h5>Used substitutes · {usedBench.length}</h5>
                <BenchList rows={usedBench} marksFor={marksFor} />
              </>
            )}
            {unusedBench.length > 0 && (
              <>
                <h5>Unused bench · {unusedBench.length}</h5>
                <BenchList rows={unusedBench} marksFor={marksFor} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
