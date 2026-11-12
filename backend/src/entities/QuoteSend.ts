import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { QuoteSendMethod } from '../enums';
import { Quote } from './Quote';
import { User } from './User';

/** One send of a quote (email / download / secure link) with a snapshot of what went out. */
@Entity('quote_sends')
export class QuoteSend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => Quote, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote: Quote;

  @Column({ type: 'integer' })
  revision: number;

  @Column({ type: 'text' })
  method: QuoteSendMethod;

  @Column({ name: 'sent_to', type: 'text', nullable: true })
  sentTo: string | null;

  /** The quote header + lines exactly as sent. */
  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sent_by' })
  sentBy: User | null;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;
}
