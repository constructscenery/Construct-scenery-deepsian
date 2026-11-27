import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One version of a rate-card rate (RC-01). Rows are never edited once they are in use: a change closes
 * the current row (effective_to) and inserts a new one (effective_from). At most one current row per grade.
 * Commercial columns: NULL = Auto (standard × commercial uplift %), a value = Set (used as entered).
 */
@Entity('bectu_rates')
@Index('uq_bectu_rates_version', ['trade', 'rank', 'rateYear', 'effectiveFrom'], { unique: true })
@Index('uq_bectu_rates_one_current', ['trade', 'rank'], { unique: true, where: 'effective_to IS NULL' })
export class BectuRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  trade: string;

  @Column({ type: 'text' })
  rank: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'daily_rate', nullable: true })
  dailyRate: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'overtime_rate', nullable: true })
  overtimeRate: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'weekly_rate', nullable: true })
  weeklyRate: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'commercial_daily_rate', nullable: true })
  commercialDailyRate: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'commercial_overtime_rate', nullable: true })
  commercialOvertimeRate: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'commercial_weekly_rate', nullable: true })
  commercialWeeklyRate: number | null;

  @Column({ type: 'text', name: 'rate_year', default: '2026/27' })
  rateYear: string;

  /** 'bectu' | 'non_bectu' */
  @Column({ type: 'text', name: 'rate_type', nullable: true, default: 'bectu' })
  rateType: string | null;

  @Column({ type: 'date', name: 'effective_from', nullable: true })
  effectiveFrom: string | null;

  @Column({ type: 'date', name: 'effective_to', nullable: true })
  effectiveTo: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @Column({ type: 'text', name: 'change_note', nullable: true })
  changeNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
