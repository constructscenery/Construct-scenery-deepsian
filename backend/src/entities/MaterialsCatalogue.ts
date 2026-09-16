import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('materials_catalogue')
export class MaterialsCatalogue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'supplier_name' })
  supplierName: string | null;

  @Column({ type: 'text', name: 'material_name', nullable: true })
  materialName: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ type: 'text', name: 'product_description' })
  productDescription: string;

  @Column({ type: 'text', name: 'unit_of_measure', nullable: true })
  unitOfMeasure: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'date', name: 'price_updated_date', nullable: true })
  priceUpdatedDate: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
