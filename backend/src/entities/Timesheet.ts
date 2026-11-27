import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { TimesheetStatus } from '../enums';
import { CrewMember } from './CrewMember';
import { Production } from './Production';
import { User } from './User';

@Entity('timesheets')
@Unique(['crewMemberId', 'productionId', 'weekEndingDate'])
@Index('idx_timesheets_crew', ['crewMemberId'])
@Index('idx_timesheets_production', ['productionId'])
@Index('idx_timesheets_week', ['weekEndingDate'])
export class Timesheet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'crew_member_id' })
  crewMemberId: string;

  @ManyToOne(() => CrewMember)
  @JoinColumn({ name: 'crew_member_id' })
  crewMember: CrewMember;

  @Column({ type: 'uuid', name: 'production_id' })
  productionId: string;

  @ManyToOne(() => Production)
  @JoinColumn({ name: 'production_id' })
  production: Production;

  @Column({ type: 'date', name: 'week_ending_date' })
  weekEndingDate: string;

  @Column({ type: 'text', default: TimesheetStatus.DRAFT })
  status: TimesheetStatus;

  @Column({ type: 'text', name: 'invoice_attachment_url', nullable: true })
  invoiceAttachmentUrl: string | null;

  @Column({ type: 'text', name: 'invoice_attachment_name', nullable: true })
  invoiceAttachmentName: string | null;

  /** FB-06 — set when a self-employed timesheet was verified without an invoice */
  @Column({ type: 'text', name: 'invoice_override_reason', nullable: true })
  invoiceOverrideReason: string | null;

  @Column({ type: 'uuid', name: 'invoice_override_by', nullable: true })
  invoiceOverrideById: string | null;

  @Column({ type: 'timestamptz', name: 'invoice_override_at', nullable: true })
  invoiceOverrideAt: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'weekly_rate', default: 0 })
  weeklyRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'sixth_day_payment', default: 0 })
  sixthDayPayment: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'seventh_day_payment', default: 0 })
  seventhDayPayment: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'overtime_amount', default: 0 })
  overtimeAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'meal_allowance_total', default: 0 })
  mealAllowanceTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'mileage_and_travel', default: 0 })
  mileageAndTravel: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  vat: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'gross_total', default: 0 })
  grossTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'grand_total', default: 0 })
  grandTotal: number;

  /** CS-08 — rate-card multiplier used when this timesheet was last priced (1 = standard, 1.1 = commercial +10%). */
  @Column({ type: 'decimal', precision: 5, scale: 4, name: 'rate_multiplier', default: 1 })
  rateMultiplier: number;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'amended_at', type: 'timestamptz', nullable: true })
  amendedAt: Date | null;
}
