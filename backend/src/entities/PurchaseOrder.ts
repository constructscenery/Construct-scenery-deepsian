import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { PurchaseOrderStatus, PaidFrom } from '../enums';
import { Production } from './Production';
import { User } from './User';
import { Supplier } from './Supplier';

@Entity('purchase_orders')
@Index('idx_purchase_orders_production', ['productionId'])
@Index('idx_purchase_orders_status', ['status'])
@Index('idx_purchase_orders_date', ['dateOfPo'])
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'po_number', unique: true })
  poNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  @Column({ type: 'text', name: 'supplier_name' })
  supplierName: string;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier | null;

  @Column({ type: 'text', name: 'supplier_email', nullable: true })
  supplierEmail: string | null;

  @Column({ type: 'text', name: 'supplier_address', nullable: true })
  supplierAddress: string | null;

  @Column({ type: 'date', name: 'date_of_po' })
  dateOfPo: string;

  @Column({ type: 'uuid', name: 'production_id' })
  productionId: string;

  @ManyToOne(() => Production)
  @JoinColumn({ name: 'production_id' })
  production: Production;

  @Column({ type: 'text', name: 'set_code', nullable: true })
  setCode: string | null;

  @Column({ type: 'text', name: 'account_code', nullable: true })
  accountCode: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', name: 'department', nullable: true })
  department: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'net_amount' })
  netAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  vat: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'gross_amount' })
  grossAmount: number;

  @Column({ type: 'text', name: 'paid_from', nullable: true })
  paidFrom: PaidFrom | null;

  @Column({ type: 'text', name: 'invoice_attachment_url', nullable: true })
  invoiceAttachmentUrl: string | null;

  @Column({ type: 'text', name: 'invoice_attachment_name', nullable: true })
  invoiceAttachmentName: string | null;

  @Column({ type: 'text', nullable: true })
  confirmation_attachment_url: string;

  @Column({ type: 'text', nullable: true })
  confirmation_attachment_name: string;

  @Column({ type: 'text', default: PurchaseOrderStatus.DRAFT })
  status: PurchaseOrderStatus;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @Column({ type: 'uuid', name: 'approved_by', nullable: true })
  approvedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: User | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
