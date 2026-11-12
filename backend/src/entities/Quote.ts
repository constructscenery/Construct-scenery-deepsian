import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { QuoteStatus, QuoteRecipientType, VatTreatment, DiscountType } from '../enums';
import { Production } from './Production';
import { User } from './User';
import { QuoteLine } from './QuoteLine';

/**
 * Quote header. subtotal / discountAmount / vatAmount / total are an aggregate of
 * quote_lines, recalculated server-side on every change (services/quoteCalculations.js).
 */
@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  reference: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ name: 'quote_date', type: 'date' })
  quoteDate: string;

  @Column({ name: 'valid_until', type: 'date' })
  validUntil: string;

  @Column({ name: 'recipient_type', type: 'text' })
  recipientType: QuoteRecipientType;

  @Column({ name: 'production_id', type: 'uuid', nullable: true })
  productionId: string | null;

  @ManyToOne(() => Production, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'production_id' })
  production: Production | null;

  @Column({ type: 'text', nullable: true })
  department: string | null;

  @Column({ name: 'recipient_name', type: 'text', nullable: true })
  recipientName: string | null;

  @Column({ name: 'recipient_company', type: 'text', nullable: true })
  recipientCompany: string | null;

  @Column({ name: 'recipient_email', type: 'text', nullable: true })
  recipientEmail: string | null;

  @Column({ type: 'text', nullable: true })
  introduction: string | null;

  @Column({ name: 'footer_notes', type: 'text', nullable: true })
  footerNotes: string | null;

  @Column({ name: 'discount_type', type: 'text', nullable: true })
  discountType: DiscountType | null;

  @Column({ name: 'discount_value', type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountValue: number;

  @Column({ name: 'vat_treatment', type: 'text', default: VatTreatment.STANDARD })
  vatTreatment: VatTreatment;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'vat_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'text', default: QuoteStatus.DRAFT })
  status: QuoteStatus;

  @Column({ name: 'status_note', type: 'text', nullable: true })
  statusNote: string | null;

  @Column({ name: 'po_reference', type: 'text', nullable: true })
  poReference: string | null;

  /** 1 for the first version; +1 each time a Sent quote is revised. */
  @Column({ type: 'integer', default: 1 })
  revision: number;

  /** Token for the secure preview link; set the first time the quote is shared by link. */
  @Column({ name: 'share_token', type: 'text', nullable: true, unique: true })
  shareToken: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'declined_at', type: 'timestamptz', nullable: true })
  declinedAt: Date | null;

  @Column({ name: 'invoice_raised_at', type: 'timestamptz', nullable: true })
  invoiceRaisedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @OneToMany(() => QuoteLine, (line) => line.quote)
  lines: QuoteLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
