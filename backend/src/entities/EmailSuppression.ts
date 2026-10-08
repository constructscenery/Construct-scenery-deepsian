import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { EmailSuppressionReason } from '../enums';

@Entity('email_suppressions')
export class EmailSuppression {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'email' })
  email: string;

  @Column({ type: 'text', name: 'reason' })
  reason: EmailSuppressionReason;

  @Column({ type: 'text', name: 'detail', nullable: true })
  detail: string | null;

  @Column({ type: 'uuid', name: 'email_event_id', nullable: true })
  emailEventId: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', name: 'cleared_at', nullable: true })
  clearedAt: Date | null;

  @Column({ type: 'uuid', name: 'cleared_by', nullable: true })
  clearedBy: string | null;

  @Column({ type: 'text', name: 'cleared_note', nullable: true })
  clearedNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
