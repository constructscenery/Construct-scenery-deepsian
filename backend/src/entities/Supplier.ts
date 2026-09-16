import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ type: 'text', name: 'primary_contact_name', nullable: true })
  primaryContactName: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', name: 'street_name', nullable: true })
  streetName: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  county: string | null;

  @Column({ type: 'text', name: 'zip_code', nullable: true })
  zipCode: string | null;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text', name: 'account_number', nullable: true })
  accountNumber: string | null;

  @Column({ type: 'text', name: 'credit_terms', nullable: true })
  creditTerms: string | null;

  @Column({ type: 'text', name: 'payment_terms', nullable: true })
  paymentTerms: string | null;

  @Column({ type: 'text', name: 'lead_times', nullable: true })
  leadTimes: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
