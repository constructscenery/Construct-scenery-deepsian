import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('buildings')
export class Building {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'ownership_status', length: 50, nullable: true })
  ownershipStatus: string | null;

  @Column({ name: 'lease_expiry', type: 'date', nullable: true })
  leaseExpiry: string | null;

  @Column({ name: 'landlord_contact', type: 'text', nullable: true })
  landlordContact: string | null;

  @Column({ name: 'access_code', type: 'text', nullable: true })
  accessCode: string | null;

  @Column({ type: 'jsonb', nullable: true })
  utilities: any | null;

  @Column({ name: 'insurance_policies', type: 'jsonb', nullable: true })
  insurancePolicies: any | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
