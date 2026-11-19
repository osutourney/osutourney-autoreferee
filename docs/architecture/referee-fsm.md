# Referee FSM

Phases: `setup` → `joining` → (`warmup_vote` → `warmups`) → `roll_choice` → `drafting` ↔ `playing` → (`tb_*`) → `finished` | `forfeit`.

Qualifiers / `play_all`: `setup` → `joining` → `playing_all` → `finished`.

Timers abort when a new timer starts (`!mp aborttimer` + local timeout).
