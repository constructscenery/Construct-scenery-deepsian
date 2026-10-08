import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { DayOfWeek } from '../enums';

/** Daily rows of a crew-submitted timesheet (child table, 3NF). Copied into timesheet_entries via the existing saveEntries logic on approval. */
@Entity('crew_timesheet_submission_entries')
export class CrewTimesheetSubmissionEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'submission_id' })
  submissionId: string;

  @Column({ type: 'date', name: 'date' })
  date: string;

  @Column({ type: 'text', name: 'day_of_week' })
  dayOfWeek: DayOfWeek;

  @Column({ type: 'boolean', name: 'full_day_worked', default: false })
  fullDayWorked: boolean;

  @Column({ type: 'decimal', precision: 6, scale: 2, name: 'overtime_hours', default: 0 })
  overtimeHours: number;

  @Column({ type: 'text', name: 'set_number', nullable: true })
  setNumber: string | null;

  @Column({ type: 'text', name: 'site', nullable: true })
  site: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'travel', default: 0 })
  travel: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'mileage', default: 0 })
  mileage: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'per_diem', default: 0 })
  perDiem: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'ad_hoc_reimbursement', default: 0 })
  adHocReimbursement: number;

  @Column({ type: 'boolean', name: 'meal_breakfast', default: false })
  mealBreakfast: boolean;

  @Column({ type: 'boolean', name: 'meal_lunch', default: false })
  mealLunch: boolean;

  @Column({ type: 'boolean', name: 'meal_supper', default: false })
  mealSupper: boolean;
}
