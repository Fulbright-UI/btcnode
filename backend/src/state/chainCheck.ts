import type { StatusSnapshot } from '@btcnode/shared';
import type { AnnouncementTracker } from '../journal/announcements.js';

/**
 * Judge the chain-check samples of the last hour against our own height AT
 * THAT TIME — a sample from fifty minutes ago must not be compared with the
 * tip of now, or every stranger from before the last block looks behind.
 *
 * The height in the version handshake is a bare claim, and strangers lie:
 * several peers once announced 1,400 blocks more than the chain had, for
 * hours, while not a single header above our tip ever arrived. A single red
 * dot stays a red dot; the state bar turns only when at least two samples
 * of the hour are ahead AND the newest one is among them — that is what a
 * real lag looks like.
 */
export function judgeChainCheck(
  tracker: AnnouncementTracker,
  tip: number | null,
  inSync: boolean,
): StatusSnapshot['chainCheck'] {
  const unsupported = tracker.formatGaps.has('sample');
  if (!tip || !inSync || !tracker.samples.length) {
    return { samples: [], ahead: 0, alarm: false, unsupported };
  }
  let ahead = 0;
  const samples = tracker.samples.map((s) => {
    const ours = tracker.ownHeightAt(s.at, tip);
    let verdict: 'same' | 'behind' | 'ahead' = 'same';
    if (s.height > ours + 1) {
      verdict = 'ahead';
      ahead = Math.max(ahead, s.height - ours);
    } else if (s.height < ours - 1) {
      verdict = 'behind';
    }
    return { at: s.at, peerId: s.peerId, height: s.height, verdict };
  });
  const aheadCount = samples.filter((s) => s.verdict === 'ahead').length;
  const alarm = aheadCount >= 2 && samples[samples.length - 1]!.verdict === 'ahead';
  return { samples, ahead, alarm, unsupported };
}
