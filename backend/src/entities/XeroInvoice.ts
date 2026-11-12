import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { XeroInvoiceStatus } from '../enums';
import { Production } from './Production';
import { User } from './User';

/** Local cache of a Xero sales invoice (ACCREC). Read-only mirror of Xero except for the allocation columns. */
@Entity('xero_invoices')
export class XeroInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'xero_invoice_id', type: 'text', unique: true })
  xeroInvoiceId: string;

  @Column({ name: 'invoice_number', type: 'text', nullable: true })
  invoiceNumber: string | null;

  @Column({ name: 'contact_name', type: 'text', nullable: true })
  contactName: string | null;

  @Column({ name: 'invoice_date', type: 'date', nullable: true })
  invoiceDate: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'sub_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  subTotal: number;

  @Column({ name: 'total_tax', type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalTax: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ name: 'amount_paid', type: 'decimal', precision: 12, scale: 2, default: 0 })
  amountPaid: number;

  @Column({ name: 'amount_credited', type: 'decimal', precision: 12, scale: 2, default: 0 })
  amountCredited: number;

  @Column({ name: 'amount_due', type: 'decimal', precision: 12, scale: 2, default: 0 })
  amountDue: number;

  @Column({ name: 'currency_code', type: 'text', default: 'GBP' })
  currencyCode: string;

  @Column({ name: 'xero_status', type: 'text' })
  xeroStatus: XeroInvoiceStatus;

  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @Column({ name: 'xero_updated_at', type: 'timestamptz', nullable: true })
  xeroUpdatedAt: Date | null;

  @Column({ name: 'production_id', type: 'uuid', nullable: true })
  productionId: string | null;

  @ManyToOne(() => Production, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'production_id' })
  production: Production | null;

  @Column({ name: 'allocated_by', type: 'uuid', nullable: true })
  allocatedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'allocated_by' })
  allocatedBy: User | null;

  @Column({ name: 'allocated_at', type: 'timestamptz', nullable: true })
  allocatedAt: Date | null;

  @Column({ name: 'first_synced_at', type: 'timestamptz' })
  firstSyncedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
