# Node setup scripts

*[English version](README.md)*

Fünf Shell-Skripte, die aus einem Raspberry Pi einen Bitcoin-Fullnode machen —
Datenträger, Bitcoin Core, Electrum-Server, Tor — und ein optionales sechstes,
das die Tor-Umstellung übernimmt, sobald die Kette steht. Kein Framework, kein
Docker, kein fertiges Abbild — Skripte, die man an einem Abend lesen kann.

**Lies sie, bevor du sie ausführst.** Jedes sagt oben, was es tut und was
nicht. Eines davon löscht Datenträger. Genau deshalb sind es getrennte
Skripte und nicht eines: Du entscheidest jeden Schritt selbst und kannst nach
jedem aufhören.

Das Dashboard liegt im selben Repository: läuft der Node, richtet `sudo bash
scripts/install.sh` aus dem Wurzelverzeichnis es ein (siehe Haupt-README).

---

## Die Schritte

| Skript | Was es tut | Ändert das System |
|---|---|---|
| `10-check.sh` | Bestandsaufnahme: Hardware, Stromversorgung, Datenträger, was schon läuft | nein |
| `20-storage.sh` | LVM über einen oder mehrere Datenträger, ext4, fstab per UUID | **löscht Datenträger** |
| `30-bitcoin-core.sh` | Bitcoin Core, geprüft per Prüfsumme und ≥3 Entwicklersignaturen, als Dienst | ja |
| `40-electrs.sh` | Electrum-Server aus der Quelle gebaut, damit die Wallet den eigenen Node fragt | ja |
| `50-tor.sh` | Tor, Onion-Dienst, schließt Port 8333 | ja |
| `55-i2p.sh` | optional: I2P als zweites anonymes Netz neben Tor, für mehr Peers ohne sichtbare IP | ja |
| `60-tor-automatic.sh` | optional: ruft `50-tor.sh` selbsttätig auf, sobald die Kette steht | ja |

In dieser Reihenfolge. Jedes Skript ist wiederholbar: Zweimal ausführen macht
nichts kaputt. `20-storage.sh` ist wiederholbar in dem Sinn, dass das Ergebnis
dasselbe ist — nicht in dem Sinn, dass Daten überleben.

```bash
git clone https://github.com/Fulbright-UI/btcnode.git
cd btcnode/scripts/node-setup

bash 10-check.sh                                   # ändert nichts
sudo bash 20-storage.sh --disks /dev/sdb           # ein Plan, noch keine Änderung
sudo bash 20-storage.sh --disks /dev/sdb --wipe    # jetzt wird gelöscht
sudo bash 30-bitcoin-core.sh --datadir /mnt/bitcoin/bitcoin
```

Dann warten. Die Erstsynchronisation dauert auf einem Pi 4 drei bis zehn Tage.
Erst danach:

```bash
sudo bash 40-electrs.sh
sudo bash 50-tor.sh
```

`50-tor.sh` verweigert die Umstellung, solange die Kette nicht steht, und sagt
warum.

Über Tor allein hat der Node 20–25 Peers, und alle sind Tor-Peers. Wer mehr
will — damit sich mehr Fremde Blöcke bei ihm holen können — ohne je die
Heim-IP zu zeigen, nimmt I2P dazu:

```bash
sudo bash 55-i2p.sh
```

Es installiert `i2pd`, gibt Core eine eigene I2P-Adresse und setzt
`onlynet=i2p` neben das vorhandene `onlynet=onion`; Clearnet bleibt aus. Die
ersten I2P-Peers kommen nach einer Viertelstunde, nach einem Tag etwa die
doppelte Peer-Zahl. Kostet rund 100 MB Arbeitsspeicher. `--revert` baut es
zurück. (Clearnet-Peers „ohne sichtbare IP" gibt es nicht: eine
Clearnet-Verbindung *ist* die IP.)

`40-electrs.sh` baut auf Wunsch schon während der Synchronisation — das
Übersetzen dauert auf einem Pi Stunden, und die Zeit liegt ohnehin brach —,
lässt den Dienst aber **abgeschaltet**, bis die Kette steht. Sein erster
Indexlauf liest die gesamte Blockchain und schreibt eine eigene Datenbank, auf
derselben SSD und denselben Kernen, mit denen Bitcoin Core gerade prüft. Auf
einem 4-GB-Pi passt beides nicht nebeneinander: Beides wird langsamer, und
fertig wird nichts früher. Sobald die Kette steht:

```bash
sudo systemctl enable --now electrs
```

oder man überlässt es `60-tor-automatic.sh` weiter unten.

---

## Auf Tor umstellen, ohne dafür wach zu bleiben

Die Synchronisation ist fertig, wann sie fertig ist — oft um vier Uhr morgens.
Bis `50-tor.sh` gelaufen ist, sieht jede Gegenstelle weiterhin deine
Heimadresse. Wer auf diesen Moment nicht warten will:

```bash
sudo bash 60-tor-automatic.sh            # einrichten
sudo bash 60-tor-automatic.sh --status   # nachsehen, was er gerade denkt
sudo bash 60-tor-automatic.sh --off      # wieder abschalten
```

Ein Timer fragt den Node dann alle zehn Minuten, ob die Kette steht. Ist sie
das eine Stunde lang durchgehend — sechs Messungen, damit ein einzelner
Ausreißer kurz vor Schluss nichts auslöst —, erledigt er zwei Dinge und
schaltet seinen eigenen Timer ab:

1. `50-tor.sh` — Tor, Onion-Dienst, Port 8333 zu, bitcoind neu gestartet
2. `electrs`, falls `40-electrs.sh` ihn eingerichtet und abgeschaltet gelassen hat

In dieser Reihenfolge, denn electrs braucht einen Node, der antwortet — und den
gibt es erst nach dem Neustart aus Schritt 1.

**Das ist freiwillig, und es ist der einzige Teil dieses Projekts, der deinen
Node ändert, während du nicht hinsiehst.** Der Wächter läuft als root ohne die
Abschottung, die die anderen Dienste bekommen — die Umstellung installiert ein
Paket, schreibt nach `/etc` und ändert die Firewall. Zwei Dinge folgen daraus,
beide mit Absicht:

- Die Markierung „erledigt" wird **vor** dem Aufruf von `50-tor.sh`
  geschrieben, nicht danach. Bricht der Rechner mitten in der Umstellung weg,
  wird nichts wiederholt — eine halb umgestellte Konfiguration ein zweites Mal
  zu überfahren macht es schlimmer. Im Journal steht dann, wie man es
  zurücknimmt oder von Hand zu Ende bringt.
- Am Node fragt er ausschließlich `getblockchaininfo`. Alles andere erledigt
  `50-tor.sh`, und das sichert vorher deine `bitcoin.conf`.

Wer diesen Handel nicht eingehen will, lässt das Skript weg. Nichts anderes
hier hängt davon ab, und `sudo bash 50-tor.sh` tut dasselbe, während du
zusiehst.

---

## Der Datenträger-Schritt, ausführlich

`20-storage.sh` ist das einzige Skript hier, das etwas unwiderruflich
zerstören kann. Entsprechend ist es gebaut.

**Ohne `--wipe` ändert es nichts.** Es zeigt, was es tun würde — welche
Geräte, welches Modell, welche Seriennummer, was gerade darauf liegt, wieviel
das zusammen ergibt — und hört auf. Das ist keine Höflichkeit, sondern der
Unterschied zwischen „ein falscher Gerätename kostet dich eine neue
Synchronisation" und „ein falscher Gerätename kostet dich deine Daten".

**Vier Verweigerungen, bevor überhaupt etwas passiert:**

- das Argument muss ein ganzer Datenträger sein, keine Partition
- er darf nicht der Träger sein, von dem das laufende System startet
- `/` oder `/boot` dürfen nicht darauf liegen
- nichts darauf darf gerade eingehängt sein — das Skript hängt keine fremden
  Dateisysteme hinter deinem Rücken aus

**Die Bestätigung verlangt den Gerätepfad, nicht „ja".** Eine Bestätigung, die
man ohne Lesen geben kann, ist keine. `/dev/sdb` einzutippen zwingt dich, den
Namen noch einmal anzusehen — und genau dort passiert der Fehler.

**Ohne Terminal verweigert es.** In eine Pipe geleitet kann niemand
bestätigen, also hört es auf, statt zu raten. `--yes` gibt es für skriptgesteuerte
Installationen und nimmt dir dieses Netz bewusst wieder ab.

`tests/check.sh` prüft das alles, ohne etwas auszuführen — unter anderem, dass
kein löschender Befehl oberhalb der `--wipe`-Sperre steht.

---

## Worauf die Skripte achten

Das sind die Dinge, die Zeit gekostet haben, aufgeschrieben, damit sie niemand
zweimal lernen muss.

**dbcache bleibt auf der Vorgabe von Bitcoin Core.** Seit v31 hängt diese
Vorgabe bereits am Arbeitsspeicher — 1024 MiB, oder 450 MiB unter 4 GB —, es
bleibt also wenig, worin man klüger sein könnte. Die Skripte schreiben den Wert
trotzdem aus, damit in der bitcoin.conf ablesbar ist, womit der Node läuft, aber
sie weichen nicht davon ab.

Beide Richtungen einer Abweichung sind hier bezahlt worden. **Zu hoch bricht
laut zusammen:** Auf einem 4-GB-Pi stand dbcache versuchsweise auf 2000. Zwei
Stunden lang schnell — 39 Blöcke pro Minute gegenüber 15 —, dann Absturz auf 13,
unter den Ausgangswert. Der Cache plus bitcoinds eigener Bedarf plus
Seitenpuffer passten nicht mehr in den Arbeitsspeicher, der Kernel schob ein
Gigabyte nach zram, und von da an verbrachte der Rechner ein Drittel seiner
Rechenzeit damit, seinen eigenen Zwischenspeicher zu komprimieren, statt Blöcke
zu prüfen. Die Falle daran: Es sieht anfangs wie ein großer Gewinn aus. Solange
der Cache klein ist, ist er es auch.

**Zu niedrig verhungert leise**, und das ist der schlimmere Fall, weil es
niemand meldet. Die Korrektur des obigen Fehlers von Hand endete bei
dbcache=270 mit maxmempool=30 — eine wirksame Grenze von 300 MB. Auf Blockhöhe
467.000 musste damit fast jeder Eingang aus der LevelDB von der Platte geholt
werden: 300 MB/s gelesen, um 0,5 MB/s Blockdaten zu verarbeiten, Nutzerzeit bei
1 Prozent, der Rest Warten. Die Kette lief weiter, nur langsam, und keine
Protokollzeile sagte warum.

**Die wirksame Grenze ist dbcache plus freier Mempool.** Bitcoin Core schlägt
den ungenutzten Mempool-Platz dem UTXO-Speicher zu, und während der
Erstsynchronisation ist der Mempool leer — beide Werte zählen also voll. Auf
einem 4-GB-Gerät sind das 750 MB, rund ein Fünftel des Arbeitsspeichers. Wer
abweicht, hält die Summe unter einem Viertel und lässt den Rest dem
Seitenpuffer.

**Unterspannung ist die häufigste Ursache beschädigter Blockchain-Daten.**
`10-check.sh` liest `get_throttled` vor dem Start, und `20-storage.sh` liest es
nach der Belastung des Datenträgers erneut — denn ein Netzteil, das im Leerlauf
hält, ist nicht dasselbe wie eines, das unter Last hält.

**Bitcoin Core wird per Signatur geprüft, nicht nur per Prüfsumme.** Eine
Prüfsumme allein beweist nichts: Wer das Archiv austauschen kann, kann auch
die Prüfsummendatei austauschen. Was zählt, ist, dass mehrere Personen den
Quellcode unabhängig voneinander übersetzt und dieselbe Binärdatei erhalten
haben. Das Skript verlangt mindestens drei gültige Signaturen und bricht bei
weniger ab.

**Protokolle in den Arbeitsspeicher, Auslagerung auf den Datenträger.** Die
zweithäufigste Ausfallursache bei Pi-Nodes ist eine durchgeschriebene
SD-Karte.

**Nirgends ist ein Gerät fest eingetragen.** Die Datenträger kommen immer von
der Befehlszeile. Ein festes `/dev/sdb` in einem Skript, das löscht, ist die
Art, wie fremde Daten verschwinden.

---

## Voraussetzungen

- Ein 64-Bit-Rechner. Getestet auf einem Raspberry Pi 4 mit 4 GB und auf
  Debian 13
- Ein Datenträger für die Kette. Rund 900 GB für das vollständige Archiv;
  darunter bietet die Installation Pruning an, das weiterhin jeden Block prüft
- Ein Netzteil, das hält. Auf einem Pi heißt das: das offizielle oder besser

---

## Prüfen

```bash
bash tests/check.sh
```

Läuft ohne root und fasst nichts an. Geprüft wird die Form der Skripte: dass
jede Sperre da ist, dass kein löschender Befehl oberhalb der `--wipe`-Sperre
steht, dass jede Frage ohne Terminal übersprungen werden kann und dass keine
persönlichen Daten oder festen Gerätenamen in den Dateien stehen.

Das ersetzt kein Ausführen — ein Partitionierungsskript lässt sich nur auf
einem Datenträger erproben, den man verlieren darf. Was es ersetzt, ist die
Sorte Fehler, bei der ein Umbau still eine Sicherung entfernt.

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
