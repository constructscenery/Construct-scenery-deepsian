import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { CrewSubmissionStatus } from '../enums';
import { CrewMember } from './CrewMember';
import { Production } from './Production';

@Entity('crew_invoice_submissions')
export class CrewInvoiceSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'crew_member_id' })
  crewMemberId: string;

  @Column({ type: 'uuid', name: 'production_id' })
  productionId: string;

  @Column({ type: 'date', name: 'week_ending_date' })
  weekEndingDate: string;

  @Column({ type: 'text', name: 'invoice_number', nullable: true })
  invoiceNumber: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'amount', nullable: true })
  amount: number | null;

  @Column({ type: 'text', name: 'file_url' })
  fileUrl: string;

  @Column({ type: 'text', name: 'file_key', nullable: true })
  fileKey: string | null;

  @Column({ type: 'text', name: 'file_name' })
  fileName: string;

  @Column({ type: 'bigint', name: 'file_size', nullable: true })
  fileSize: string | null;

  @Column({ type: 'text', name: 'file_mime_type', nullable: true })
  fileMimeType: string | null;

  @Column({ type: 'text', name: 'status', default: CrewSubmissionStatus.SUBMITTED })
  status: CrewSubmissionStatus;

  @Column({ type: 'text', name: 'crew_notes', nullable: true })
  crewNotes: string | null;

  @Column({ type: 'text', name: 'reviewer_notes', nullable: true })
  reviewerNotes: string | null;

  @Column({ type: 'integer', name: 'revision', default: 1 })
  revision: number;

  @Column({ type: 'uuid', name: 'timesheet_id', nullable: true })
  timesheetId: string | null;

  @Column({ type: 'timestamptz', name: 'submitted_at', default: () => 'NOW()' })
  submittedAt: Date;

  @Column({ type: 'uuid', name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'timestamptz', name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @ManyToOne(() => CrewMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'crew_member_id' })
  crewMember?: CrewMember;

  @ManyToOne(() => Production, { nullable: true })
  @JoinColumn({ name: 'production_id' })
  production?: Production;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
