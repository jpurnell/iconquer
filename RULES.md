
# RULES.md
# iConquer / Risk Game Rules Reference

This document explains the **core rules of the Risk board game**, which form the basis of gameplay in **iConquer**.  
The mechanics are faithful to the classic board game, with one key difference: **dice rolling is hidden and resolved automatically**.

---

# 1. Objective of the Game

The goal of Risk (and iConquer) is simple:

**Control the entire world map by eliminating all opposing players.**

A player wins when they are the **last remaining player controlling territories**.

---

# 2. Players

Standard gameplay includes:

- **6 players**
- Each player controls a color/faction
- Each player commands armies placed in territories

Players may be:

- Human players
- Computer players
- AI agents (in iConquer Reborn)

---

# 3. The Map

The default Risk world map contains:

- **42 countries (territories)**
- grouped into **6 continents**

Typical continents include:

- North America
- South America
- Europe
- Africa
- Asia
- Australia

Each territory can hold any number of armies.

---

# 4. Starting the Game

At the start of the game:

1. The **42 territories are distributed among players**
  - players can take turns selecting or they can be assigned randomly, depending upon settings
2. Each territory begins with at least one army (board game only)
  - Physical game: minimum of one army per country, colored game piece indicates ownerships
  - Computer game: minimum of zero armies per country, ownership indicated by color 
3. Players receive additional armies to place during setup


---

# 5. Turn Structure

Each player's turn consists of three phases:

1. **Reinforcement**
2. **Attack**
3. **Fortification**

These phases repeat until the player ends their turn.

---

# 6. Reinforcement Phase

At the start of a turn, the player receives new armies.

The number of armies is determined by:

### Territory Control

Players receive:

    floor(number_of_territories / 3)

Minimum reinforcement is **3 armies per turn**.

### Continent Bonuses

If a player controls an entire continent, they receive a bonus.

Typical Risk continent bonuses:

| Continent | Bonus Armies |
|----------|--------------|
| North America | 5 |
| South America | 2 |
| Europe | 5 |
| Africa | 3 |
| Asia | 7 |
| Australia | 2 |

Reinforcements must be placed on territories the player already controls.

---

# 7. Attack Phase

Players may attack **adjacent enemy territories**.

Requirements:

- The attacking territory must contain **at least 2 armies**
- One army must remain behind after the attack

Players may attack **as many times as they want** during the attack phase.

---

# 8. Battle Resolution

In the physical board game, battles are resolved by rolling dice.

- Attacker rolls up to **3 dice**
- Defender rolls up to **2 dice**
- Dice are compared highest-to-highest

For each comparison:

- Higher die wins
- Loser removes one army

---

# 9. Hidden Dice in iConquer

In **iConquer**, the dice are not shown to the player.

Instead:

- The same dice mechanics are used internally
- The results are applied automatically

When a player clicks **Attack**, the system calculates the dice results in the background.

The player simply sees:

- attacking armies decrease
- defending armies decrease

until either:

- the attacker stops attacking
- the defender is eliminated

This preserves the **probabilistic combat mechanics of Risk** without showing dice.


---

# 10. Capturing a Territory

If the defender loses all armies in a territory:

- The attacker captures the territory
- The attacker must move **at least one army** into the newly captured territory (physical game only)

The territory now belongs to the attacking player.

---

# 11. Fortification Phase

At the end of the turn, the player may **move as many armies as they'd like** from one (and only one) of their territories into one (and only one) of their **adjacent** territories, provided:

- the source and target territories are adjacent
- the player owns both territories
- at least **one army** remains behind on the source territory
- the move happens only once per turn

This allows players to reposition their defenses.

---

# 12. Player Elimination

If a player loses all territories:

- They are **eliminated from the game**
- Their territories transfer to the conquering player

The game continues until only one player remains.

---

# 13. Victory Condition

The game ends when:

**One player controls all territories on the map.**

That player is declared the winner.

---

# 14. Differences Between Risk and iConquer

The core gameplay is identical, with only a few interface differences.

### Dice Visibility

Risk:
- dice are rolled visibly

iConquer:
- dice are rolled internally
- results applied automatically

## Minimum Armies

Risk:
- all countries must have at least one army

iConquer
- zero armies allowed, ownership is modeled in a different way

### Interface

Risk:
- physical board game

iConquer:
- computer interface
- click-to-attack mechanics

---

# 15. Strategic Concepts

Successful players typically focus on:

- controlling continents
- defending chokepoints
- concentrating armies
- eliminating weak opponents
- managing reinforcements efficiently

These strategies apply equally to Risk and iConquer.

---

# 16. Summary

iConquer faithfully implements the classic Risk gameplay:

- 6 players
- 42 territories
- turn-based reinforcement, attack, and fortification
- dice-based combat resolved automatically
- victory by world domination

The computer implementation simply **automates dice resolution and game management** while preserving the original mechanics.

---

End of document.
