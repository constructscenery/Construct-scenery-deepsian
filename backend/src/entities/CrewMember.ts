import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { EmploymentStatus, CrewAvailabilityStatus } from '../enums';
import { encryptTransformer } from '../utils/crypto';

@Entity('crew_members')
export class CrewMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'crew_number', unique: true })
  crewNumber: string;

  @Column({ type: 'text', name: 'first_name' })
  firstName: string;

  @Column({ type: 'text', name: 'last_name' })
  lastName: string;

  @Column({ type: 'text', name: 'date_of_birth', nullable: true, transformer: encryptTransformer })
  dateOfBirth: string | null;

  @Column({ type: 'text', name: 'home_address', nullable: true, transformer: encryptTransformer })
  homeAddress: string | null;

  @Column({ type: 'text', name: 'employment_status' })
  employmentStatus: EmploymentStatus;

  @Column({ type: 'text', name: 'crew_trade' })
  crewTrade: string;

  @Column({ type: 'text', name: 'crew_rank' })
  crewRank: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'paye_withholding_rate', default: 0 })
  payeWithholdingRate: number;

  @Column({ type: 'text', name: 'company_name', nullable: true })
  companyName: string | null;

  @Column({ type: 'text', name: 'company_registration_number', nullable: true })
  companyRegistrationNumber: string | null;

  @Column({ type: 'text', name: 'vat_registration_number', nullable: true })
  vatRegistrationNumber: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  // Encrypted at rest — AES-256-GCM via encryptTransformer
  @Column({ type: 'text', name: 'account_name', nullable: true, transformer: encryptTransformer })
  accountName: string | null;

  @Column({ type: 'text', name: 'account_number', nullable: true, transformer: encryptTransformer })
  accountNumber: string | null;

  @Column({ type: 'text', name: 'sort_code', nullable: true, transformer: encryptTransformer })
  sortCode: string | null;

  @Column({ type: 'text', name: 'emergency_contact_name', nullable: true })
  emergencyContactName: string | null;

  @Column({ type: 'text', name: 'emergency_contact_relationship', nullable: true })
  emergencyContactRelationship: string | null;

  @Column({ type: 'text', name: 'emergency_contact_phone', nullable: true, transformer: encryptTransformer })
  emergencyContactPhone: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'text', name: 'availability_status', default: CrewAvailabilityStatus.AVAILABLE })
  availabilityStatus: CrewAvailabilityStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
