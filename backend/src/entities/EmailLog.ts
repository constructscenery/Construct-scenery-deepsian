import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { EmailDeliveryStatus, EmailMessageType } from '../enums';
import { CrewMember } from './CrewMember';
import { Production } from './Production';

/** Outbound email record + durable send queue. Legacy rows (pre crew-emailing) only populate module/recipient/success/error_message/sent_at; status is NULL for them. */
@Entity('email_log')
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'module' })
  module: string;

  @Column({ type: 'uuid', name: 'related_record_id', nullable: true })
  relatedRecordId: string | null;

  @Column({ type: 'text', name: 'related_record_type', nullable: true })
  relatedRecordType: string | null;

  @Column({ type: 'text', name: 'recipient_email' })
  recipientEmail: string;

  @Column({ type: 'text', name: 'recipient_name', nullable: true })
  recipientName: string | null;

  @Column({ type: 'boolean', name: 'success', default: true })
  success: boolean;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', default: () => 'NOW()' })
  sentAt: Date;

  @Column({ type: 'text', name: 'message_type', nullable: true })
  messageType: EmailMessageType | null;

  @Column({ type: 'text', name: 'subject', nullable: true })
  subject: string | null;

  @Column({ type: 'text', name: 'body_html', nullable: true })
  bodyHtml: string | null;

  @Column({ type: 'text', name: 'body_text', nullable: true })
  bodyText: string | null;

  @Column({ type: 'uuid', name: 'crew_member_id', nullable: true })
  crewMemberId: string | null;

  @Column({ type: 'uuid', name: 'production_id', nullable: true })
  productionId: string | null;

  @Column({ type: 'date', name: 'week_ending_date', nullable: true })
  weekEndingDate: string | null;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId: string | null;

  @Column({ type: 'uuid', name: 'batch_id', nullable: true })
  batchId: string | null;

  @Column({ type: 'text', name: 'provider', nullable: true })
  provider: string | null;

  @Column({ type: 'text', name: 'provider_message_id', nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'text', name: 'status', nullable: true })
  status: EmailDeliveryStatus | null;

  @Column({ type: 'timestamptz', name: 'status_updated_at', nullable: true })
  statusUpdatedAt: Date | null;

  @Column({ type: 'integer', name: 'attempts', default: 0 })
  attempts: number;

  @Column({ type: 'integer', name: 'max_attempts', default: 5 })
  maxAttempts: number;

  @Column({ type: 'timestamptz', name: 'next_attempt_at', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', name: 'last_attempt_at', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'text', name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'text', name: 'reply_to', nullable: true })
  replyTo: string | null;

  @Column({ type: 'boolean', name: 'is_automated', default: false })
  isAutomated: boolean;

  @Column({ type: 'boolean', name: 'is_test', default: false })
  isTest: boolean;

  @Column({ type: 'uuid', name: 'sent_by', nullable: true })
  sentBy: string | null;

  @ManyToOne(() => CrewMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'crew_member_id' })
  crewMember?: CrewMember;

  @ManyToOne(() => Production, { nullable: true })
  @JoinColumn({ name: 'production_id' })
  production?: Production;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
