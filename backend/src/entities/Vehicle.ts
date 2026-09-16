import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'registration_number', length: 50 })
  registrationNumber: string;

  @Column({ length: 100 })
  make: string;

  @Column({ length: 100 })
  model: string;

  @Column({ name: 'year_of_manufacture', type: 'int', nullable: true })
  yearOfManufacture: number | null;

  @Column({ type: 'int', nullable: true })
  mileage: number | null;

  @Column({ name: 'number_plate', length: 50, nullable: true })
  numberPlate: string | null;

  @Column({ length: 50, nullable: true })
  colour: string | null;

  @Column({ name: 'vehicle_type', length: 50, nullable: true })
  vehicleType: string | null;

  @Column({ name: 'owner_assigned_to', length: 100, nullable: true })
  ownerAssignedTo: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'mot_expiry_date', type: 'date', nullable: true })
  motExpiryDate: string | null;

  @Column({ name: 'insurance_renewal_date', type: 'date', nullable: true })
  insuranceRenewalDate: string | null;

  @Column({ name: 'tax_renewal_date', type: 'date', nullable: true })
  taxRenewalDate: string | null;

  @Column({ name: 'tax_direct_debit', type: 'boolean', default: false })
  taxDirectDebit: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
