import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { EmailEventType } from '../enums';

@Entity('email_events')
export class EmailEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'email_log_id', nullable: true })
  emailLogId: string | null;

  @Column({ type: 'text', name: 'provider_message_id', nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'text', name: 'event_type' })
  eventType: EmailEventType;

  @Column({ type: 'text', name: 'recipient_email', nullable: true })
  recipientEmail: string | null;

  @Column({ type: 'text', name: 'bounce_type', nullable: true })
  bounceType: string | null;

  @Column({ type: 'text', name: 'bounce_subtype', nullable: true })
  bounceSubtype: string | null;

  @Column({ type: 'text', name: 'diagnostic', nullable: true })
  diagnostic: string | null;

  @Column({ type: 'timestamptz', name: 'occurred_at', default: () => 'NOW()' })
  occurredAt: Date;

  @Column({ type: 'text', name: 'sns_message_id', nullable: true })
  snsMessageId: string | null;

  @Column({ type: 'text', name: 'raw_payload', nullable: true })
  rawPayload: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
