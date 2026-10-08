import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { CrewSubmissionReviewAction } from '../enums';

@Entity('crew_submission_reviews')
export class CrewSubmissionReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'timesheet_submission_id', nullable: true })
  timesheetSubmissionId: string | null;

  @Column({ type: 'uuid', name: 'invoice_submission_id', nullable: true })
  invoiceSubmissionId: string | null;

  @Column({ type: 'text', name: 'action' })
  action: CrewSubmissionReviewAction;

  @Column({ type: 'text', name: 'notes', nullable: true })
  notes: string | null;

  @Column({ type: 'integer', name: 'revision', default: 1 })
  revision: number;

  @Column({ type: 'text', name: 'actor_type' })
  actorType: string;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
