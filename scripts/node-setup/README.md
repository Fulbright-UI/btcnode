# Node setup scripts

*[Deutsche Fassung](README.de.md)*

Five shell scripts that turn a Raspberry Pi into a Bitcoin full node — disk,
Bitcoin Core, Electrum server, Tor — and an optional sixth that does the Tor
switch for you once the chain is up. No framework, no Docker, no image to
flash — scripts you can read in an evening.

**Read them before you run them.** Every one of them says at the top what it
does and what it does not. One of them erases disks. That is exactly why they
are separate scripts rather than one: you decide each step yourself, and you
can stop after any of them.

The dashboard lives in the same repository: once the node runs, `sudo bash
scripts/install.sh` from the repository root puts it up (see the main README).

---

## The steps

| Script | What it does | Changes the system |
|---|---|---|
| `10-check.sh` | takes stock: hardware, power supply, disks, what is already installed | no |
| `20-storage.sh` | LVM across one or more disks, ext4, fstab by UUID | **erases disks** |
| `30-bitcoin-core.sh` | Bitcoin Core verified by checksum and ≥3 developer signatures, as a service | yes |
| `40-electrs.sh` | Electrum server built from source, so your wallet can talk to your own node | yes |
| `50-tor.sh` | Tor, onion service, closes port 8333 | yes |
| `55-i2p.sh` | optional: I2P as a second anonymous network next to Tor, for more peers without a visible IP | yes |
| `60-tor-automatic.sh` | optional: runs `50-tor.sh` by itself once the chain is up to date | yes |

Run them in this order. Every script is repeatable: running it twice does not
break anything. `20-storage.sh` is repeatable in the sense that the result is
the same — not in the sense that data survives.

```bash
git clone https://github.com/Fulbright-UI/btcnode.git
cd btcnode/scripts/node-setup

bash 10-check.sh                                   # changes nothing
sudo bash 20-storage.sh --disks /dev/sdb           # a plan, still no changes
sudo bash 20-storage.sh --disks /dev/sdb --wipe    # now it erases
sudo bash 30-bitcoin-core.sh --datadir /mnt/bitcoin/bitcoin
```

Then wait. The initial sync takes three to ten days on a Pi 4. Only afterwards:

```bash
sudo bash 40-electrs.sh
sudo bash 50-tor.sh
```

`50-tor.sh` refuses to switch before the chain is up to date, and says why.

Over Tor alone the node has 20–25 peers, and every one of them is a Tor
peer. If you want more — so that more strangers can fetch blocks from you —
without ever showing your home IP, add I2P:

```bash
sudo bash 55-i2p.sh
```

It installs `i2pd`, gives Core an I2P address of its own and adds `onlynet=i2p`
next to the existing `onlynet=onion`; clearnet stays off. Expect the first I2P
peers after a quarter of an hour and about twice the peer count after a day.
Costs about 100 MB of memory. `--revert` takes it out again. (Clearnet peers
"without exposing the IP" do not exist: a clearnet connection *is* your IP.)

`40-electrs.sh` will build during the sync if you ask it to — the compile takes
hours on a Pi and that time is otherwise idle — but it leaves the service
**switched off** until the chain is up. Its first index pass reads the whole
blockchain and writes a database of its own, on the same disk and the same
cores Bitcoin Core is using to validate. On a 4 GB Pi the two do not fit beside
each other: both get slower and neither finishes sooner. Once the chain is up:

```bash
sudo systemctl enable --now electrs
```

or let `60-tor-automatic.sh` below do it for you.

---

## Switching to Tor without staying awake for it

The sync finishes when it finishes, often at four in the morning. Until you
run `50-tor.sh`, every peer you talk to still sees your home address. If you
would rather not watch for the moment:

```bash
sudo bash 60-tor-automatic.sh            # set it up
sudo bash 60-tor-automatic.sh --status   # what it currently thinks
sudo bash 60-tor-automatic.sh --off      # switch it off again
```

A timer then asks the node every ten minutes whether the chain is up to date.
Once it has been for a full hour — six readings, so that a single outlier near
the end changes nothing — it does two things and switches its own timer off:

1. `50-tor.sh` — Tor, onion service, port 8333 closed, bitcoind restarted
2. `electrs`, if `40-electrs.sh` installed it and left it off

In that order, because electrs needs a node that answers, and the node is only
back after the restart in step 1.

**This is optional, and it is the one part of this project that changes your
node while you are not looking.** The watchdog runs as root without the
sandboxing the other services get, because the switch installs a package,
writes to `/etc` and changes the firewall. Two things follow from that, and
both are deliberate:

- The marker that says "done" is written **before** `50-tor.sh` is called, not
  after. If the machine dies half way through the switch, nothing is retried —
  running over a half-converted configuration a second time makes it worse. The
  journal then tells you how to undo it or finish by hand.
- It only ever asks the node `getblockchaininfo`. Everything else it does, it
  does through `50-tor.sh`, which backs up your `bitcoin.conf` first.

If that trade is not one you want to make, skip this script. Nothing else here
depends on it, and `sudo bash 50-tor.sh` does the same thing while you watch.

---

## The disk step, in detail

`20-storage.sh` is the only script here that can destroy something
irreversibly. It is built accordingly.

**Without `--wipe` it changes nothing.** It prints what it would do — which
devices, which model, which serial number, what is on them right now, how much
that adds up to — and exits. That is not politeness; it is the difference
between a wrong device name costing you a re-download and costing you your
data.

**Four refusals, before anything else happens:**

- the argument must be a whole disk, not a partition
- it must not be the disk the running system boots from
- `/` or `/boot` must not live on it
- nothing on it may be mounted right now — the script does not unmount other
  people's filesystems behind their back

**The confirmation asks for the device path, not for "yes".** A confirmation
you can give without reading is not a confirmation. Typing `/dev/sdb` forces
you to look at the name once more, which is exactly where the mistake happens.

**Without a terminal it refuses.** Piped into a shell nobody can confirm
anything, so it stops rather than guessing. `--yes` exists for scripted
installs and hands that safety net back to you.

`tests/check.sh` verifies all of this without running anything — including
that no destructive command sits above the `--wipe` guard.

---

## What the scripts are careful about

These are the things that cost time to learn, written down so nobody has to
learn them twice.

**dbcache is left at Bitcoin Core's default.** Since v31 that default already
depends on memory — 1024 MiB, or 450 MiB below 4 GB — so there is little left
for us to be clever about. The scripts write the value out explicitly so the
bitcoin.conf states what the node runs with, but they do not deviate from it.

Both directions of deviation have been paid for here. **Too high collapses
loudly:** on a 4 GB Pi dbcache once sat at 2000. Fast for two hours — 39 blocks
per minute against 15 — then down to 13, below where it started. The cache plus
bitcoind's own footprint plus the page cache no longer fitted into memory, the
kernel pushed a gigabyte into zram, and the machine spent a third of its CPU
time compressing its own cache instead of validating blocks. The trap is that
it looks like a big win at first: while the cache is small, it is one.

**Too low starves quietly**, and that is the worse failure because nothing
reports it. Correcting the above by hand ended at dbcache=270 with
maxmempool=30 — an effective limit of 300 MB. At block height 467,000 almost
every input then had to come from the LevelDB on disk: 300 MB/s read to process
0.5 MB/s of block data, user time at 1 per cent, the rest spent waiting. The
chain still moved, just slowly, and no log line said why.

**The effective limit is dbcache plus the free mempool.** Bitcoin Core hands
unused mempool room to the UTXO cache, and during the initial sync the mempool
is empty — so both values count in full. On a 4 GB machine that is 750 MB, or
about a fifth of memory. If you do deviate, keep the sum under a quarter of
memory and leave the rest to the page cache.

**Undervoltage is the most common cause of a corrupted blockchain database.**
`10-check.sh` reads `get_throttled` before you start, and `20-storage.sh`
reads it again after putting the disk under load — because a power supply that
holds up while idle is not the same as one that holds up under load.

**Bitcoin Core is verified by signatures, not just by checksum.** A checksum
alone proves nothing: whoever could swap the archive could swap the checksum
file with it. What carries the weight is that several people compiled the
source independently and arrived at the same binary. The script requires at
least three valid signatures and refuses to continue with fewer.

**Logs go to memory, swap goes to the data disk.** The second most common
failure of a Pi node is an SD card written to death.

**Nothing is ever hardcoded to a device.** The disks always come from the
command line. A fixed `/dev/sdb` in a script that erases disks is how somebody
else's data gets destroyed.

---

## Requirements

- A 64-bit machine. Tested on a Raspberry Pi 4 with 4 GB and on Debian 13
- One disk for the chain. About 900 GB for the full archive; below that the
  installer offers pruning, which still validates every block
- A power supply that holds up. On a Pi that means the official one or better

---

## Checking

```bash
bash tests/check.sh
```

Runs without root and touches nothing. It checks the shape of the scripts:
that every guard is present, that no destructive command sits above the
`--wipe` guard, that every question is skippable without a terminal, and that
no personal data or fixed device name is left in the files.

This cannot replace running them — a partitioning script can only be tried out
on a disk you are willing to lose. What it does replace is the class of
mistake where a refactor quietly removes a safety check.

---

## Licence

MIT — see [LICENSE](LICENSE).
