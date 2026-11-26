uiStore.setState({ villageCleared: false });
/**
 * Village Island round flow: owns the villager sim, mirrors it into the UI store, and decides when a
 * round is cleared (every villager got through) or lost (any villager is knocked out).
 * Talks to the engine only through `VillageDeps`, so tests drive it with fakes.
 */
import {
  MAX_POPULATION,
  START_POPULATION,
  VILLAGE_CONSTRAINTS,
  getVillageRound,
  loadVillageBest,
  nextPopulation,
  saveVillageBest,
  totalBeds,
} from '../../levels/village';
import { uiStore } from '../../state/store';
import type { BlueprintGraph, BuildConstraints, Strength, Vec3 } from '../../types/blueprint';
import { VillageSim } from '../village/VillageSim';
import type { VillagerView } from '../village/VillagerAvatars';

export interface VillageDeps {
  view: VillagerView;
  getGraph(): BlueprintGraph;
  /** Ids of blocks that fell during the current run. */
  getFallenIds(): Set<string>;
  /** World centres of blocks that fell during the current run (live). */
  getFallenPositions(): Vec3[];
  /** Where the players stand, for HP-bar range checks. */
  getViewers(): Vec3[];
  constraints?: BuildConstraints;
}

export class VillageController {
  private readonly sim = new VillageSim(7);
  private active = false;
  private running = false;
  private time = 0;
  private lastSignature = '';

  constructor(private readonly d: VillageDeps) {}

  isActive(): boolean {
    return this.active;
  }

  getSim(): VillageSim {
    return this.sim;
  }

  getConstraints(): BuildConstraints {
    return this.d.constraints ?? VILLAGE_CONSTRAINTS;
  }

  /** Begins a fresh village at round `round` (the island must already be switched to Village size). */
  enter(round = 1, population = START_POPULATION): void {
    this.active = true;
    this.running = false;
    this.sim.setStructure(this.d.getGraph());
    this.sim.reset(Math.min(MAX_POPULATION, Math.max(1, population)));
    this.d.view.setVisible(true);
    uiStore.setState({
      villageRound: round,
      villageBestRound: loadVillageBest(),
      villageOver: false,
      villageFailReason: null,
      villageCleared: false,
    });
    this.publish(true);
  }

  leave(): void {
    this.active = false;
    this.running = false;
    this.d.view.setVisible(false);
  }

  /** The build changed in build mode: villagers re-read the walls and shelters. */
  onBuildChanged(): void {
    if (!this.active || this.running) return;
    this.sim.setStructure(this.d.getGraph());
    this.publish(true);
  }

  /** The disaster for the current round, or null when the village is over. */
  currentRound(): { disaster: string; strength: Strength; seed: number } | null {
    if (!this.active || uiStore.getState().villageOver) return null;
    const r = getVillageRound(uiStore.getState().villageRound);
    return { disaster: r.disaster, strength: r.strength, seed: r.seed };
  }

  onDisasterStarted(strength: Strength): void {
    if (!this.active) return;
    this.running = true;
    this.sim.setStructure(this.d.getGraph());
    this.sim.startDisaster(strength);
    uiStore.setState({ villageCleared: false });
    this.publish(true);
  }

  /** The player rewound or left the run: villagers get up, healed, and walk around again. */
  onRewind(): void {
    if (!this.active) return;
    const wasRunning = this.running;
    this.running = false;
    this.sim.endDisaster();
    if (wasRunning || !uiStore.getState().villageOver) this.sim.restoreAll();
    this.sim.setStructure(this.d.getGraph());
    this.publish(true);
  }

  /** A projectile landed (world x, z). */
  onImpact(x: number, z: number): void {
    if (this.active && this.running) this.sim.impact(x, z);
  }

  /** Per-frame step. Returns true when a villager was just knocked out (the village is lost). */
  tick(dt: number): boolean {
    if (!this.active) return false;
    this.time += dt;
    if (this.running) {
      this.sim.setFallen(this.d.getFallenIds());
      this.sim.debris(
        this.d.getFallenPositions().filter((p) => p[1] > 1.5),
        dt,
      );
    }
    this.sim.update(dt);
    this.d.view.sync(this.sim.getVillagers(), this.d.getViewers(), this.time);
    this.publish(false);
    const dead = this.sim.firstDead();
    if (this.running && dead) {
      this.running = false;
      this.sim.endDisaster();
      uiStore.setState({
        villageOver: true,
        villageFailReason: 'A villager got hurt! Villagers need a strong roof and walls to hide in.',
      });
      return true;
    }
    return false;
  }

  /** Called once when the run's timer ends with everyone still standing. */
  onRunFinished(): void {
    if (!this.active || !this.running) return;
    this.running = false;
    this.sim.endDisaster();
    const s = uiStore.getState();
    const best = Math.max(s.villageBestRound, s.villageRound);
    saveVillageBest(best);
    uiStore.setState({ villageCleared: true, villageBestRound: best });
    this.publish(true);
  }

  dispose(): void {
    this.active = false;
    this.d.view.dispose();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Moves on to the next round: villagers heal, and a newcomer arrives if there is a spare bed. */
  nextRound(): void {
    if (!this.active) return;
    const s = uiStore.getState();
    const pop = nextPopulation(this.sim.getVillagers().length, totalBeds(this.sim.getShelters()));
    this.sim.restoreAll();
    this.sim.addVillagers(pop);
    uiStore.setState({ villageRound: s.villageRound + 1, villageCleared: false });
    this.publish(true);
  }

  /** Starts over from round 1 with the starting population (the build is kept). */
  restart(): void {
    this.enter(1, START_POPULATION);
  }

  /** Mirrors counts into the store, only touching it when something changed. */
  private publish(force: boolean): void {
    const villagers = this.sim.getVillagers();
    const alive = this.sim.aliveCount();
    const beds = totalBeds(this.sim.getShelters());
    const sig = `${villagers.length}|${alive}|${beds}`;
    if (!force && sig === this.lastSignature) return;
    this.lastSignature = sig;
    uiStore.setState({ villagePopulation: villagers.length, villageAlive: alive, villageBeds: beds });
  }
}
