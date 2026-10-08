import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { EmailMessageType } from '../enums';
import { Production } from './Production';

@Entity('email_batches')
export class EmailBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'message_type' })
  messageType: EmailMessageType;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId: string | null;

  @Column({ type: 'text', name: 'subject' })
  subject: string;

  @Column({ type: 'text', name: 'body' })
  body: string;

  @Column({ type: 'uuid', name: 'production_id', nullable: true })
  productionId: string | null;

  @Column({ type: 'date', name: 'week_ending_date', nullable: true })
  weekEndingDate: string | null;

  @Column({ type: 'uuid', name: 'availability_poll_id', nullable: true })
  availabilityPollId: string | null;

  @Column({ type: 'boolean', name: 'is_automated', default: false })
  isAutomated: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => Production, { nullable: true })
  @JoinColumn({ name: 'production_id' })
  production?: Production;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
