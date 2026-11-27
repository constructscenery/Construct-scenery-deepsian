import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Production } from './Production';
import { User } from './User';

@Entity('forecasts')
@Index('idx_forecasts_production', ['productionId'])
export class Forecast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'uuid', name: 'production_id', nullable: true })
  productionId: string | null;

  @ManyToOne(() => Production, { nullable: true })
  @JoinColumn({ name: 'production_id' })
  production: Production | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'total_labour_cost', default: 0 })
  totalLabourCost: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'total_materials_cost', default: 0 })
  totalMaterialsCost: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'total_forecast_cost', default: 0 })
  totalForecastCost: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'percentometer_carpenter_cost', nullable: true })
  percentometerCarpenterCost: number | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'percentometer_total', nullable: true })
  percentometerTotal: number | null;

  /** FB-07 — ATL % the scenario was calculated with (NULL = saved before above-the-line costs existed) */
  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'percentometer_atl_pct', nullable: true })
  percentometerAtlPct: number | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
