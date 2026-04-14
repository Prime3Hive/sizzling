export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      bill_of_materials: {
        Row: {
          component_sku_id: string
          created_at: string
          id: string
          parent_sku_id: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          component_sku_id: string
          created_at?: string
          id?: string
          parent_sku_id: string
          quantity: number
          updated_at?: string
          user_id: string
        }
        Update: {
          component_sku_id?: string
          created_at?: string
          id?: string
          parent_sku_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_bom_component_sku"
            columns: ["component_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bom_parent_sku"
            columns: ["parent_sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_items: {
        Row: {
          amount: number
          budget_id: string
          category: string
          created_at: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          budget_id: string
          category: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          budget_id?: string
          category?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budget_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          created_at: string | null
          created_by: string | null
          details: string | null
          end_date: string
          id: string
          start_date: string
          title: string
          total_budget: number
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          details?: string | null
          end_date: string
          id?: string
          start_date: string
          title: string
          total_budget: number
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          details?: string | null
          end_date?: string
          id?: string
          start_date?: string
          title?: string
          total_budget?: number
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      department_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_update: boolean
          can_view: boolean
          created_at: string
          department_id: string
          id: string
          module_name: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          department_id: string
          id?: string
          module_name: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          department_id?: string
          id?: string
          module_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_permissions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      discrepancies: {
        Row: {
          amount: number | null
          created_at: string
          description: string
          discrepancy_type: string
          id: string
          reconciliation_report_id: string
          reference_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          description: string
          discrepancy_type: string
          id?: string
          reconciliation_report_id: string
          reference_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          description?: string
          discrepancy_type?: string
          id?: string
          reconciliation_report_id?: string
          reference_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_discrepancies_reconciliation_report_id"
            columns: ["reconciliation_report_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_type: string | null
          amount: number
          bank_account: string | null
          budget_id: string
          category: string
          cost_center: string | null
          created_at: string | null
          created_by: string | null
          date: string
          description: string
          id: string
          payment_method: string | null
          receipt_path: string | null
          updated_at: string | null
        }
        Insert: {
          account_type?: string | null
          amount: number
          bank_account?: string | null
          budget_id: string
          category: string
          cost_center?: string | null
          created_at?: string | null
          created_by?: string | null
          date: string
          description: string
          id?: string
          payment_method?: string | null
          receipt_path?: string | null
          updated_at?: string | null
        }
        Update: {
          account_type?: string | null
          amount?: number
          bank_account?: string | null
          budget_id?: string
          category?: string
          cost_center?: string | null
          created_at?: string | null
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          payment_method?: string | null
          receipt_path?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budget_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          created_at: string
          id: string
          last_updated: string
          product_id: string
          quantity: number
          reorder_level: number
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_updated?: string
          product_id: string
          quantity?: number
          reorder_level?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_updated?: string
          product_id?: string
          quantity?: number
          reorder_level?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_product_id"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_inventory_warehouse_id"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_requests: {
        Row: {
          created_at: string
          created_by: string | null
          current_quantity: number
          fulfilled_date: string | null
          fulfilled_quantity: number
          id: string
          notes: string | null
          product_id: string
          request_date: string
          requested_quantity: number
          status: string
          updated_at: string
          user_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          fulfilled_date?: string | null
          fulfilled_quantity?: number
          id?: string
          notes?: string | null
          product_id: string
          request_date?: string
          requested_quantity: number
          status?: string
          updated_at?: string
          user_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          fulfilled_date?: string | null
          fulfilled_quantity?: number
          id?: string
          notes?: string | null
          product_id?: string
          request_date?: string
          requested_quantity?: number
          status?: string
          updated_at?: string
          user_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_requests_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      njc_supplies: {
        Row: {
          created_at: string
          id: string
          invoice_title: string | null
          number_of_supplies: number
          payment_status: string
          service_charge_amount: number
          service_charge_percent: number
          subtotal: number
          supply_date: string
          supply_details: string
          total_amount: number
          updated_at: string
          user_id: string
          vat_amount: number
          vat_percent: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_title?: string | null
          number_of_supplies: number
          payment_status?: string
          service_charge_amount?: number
          service_charge_percent?: number
          subtotal?: number
          supply_date: string
          supply_details: string
          total_amount?: number
          updated_at?: string
          user_id: string
          vat_amount?: number
          vat_percent?: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_title?: string | null
          number_of_supplies?: number
          payment_status?: string
          service_charge_amount?: number
          service_charge_percent?: number
          subtotal?: number
          supply_date?: string
          supply_details?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
          vat_amount?: number
          vat_percent?: number
        }
        Relationships: []
      }
      njc_supply_items: {
        Row: {
          created_at: string
          description: string
          id: string
          item_date: string
          line_total: number
          number_of_persons: number
          per_head_price: number
          supply_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          item_date: string
          line_total?: number
          number_of_persons?: number
          per_head_price?: number
          supply_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          item_date?: string
          line_total?: number
          number_of_persons?: number
          per_head_price?: number
          supply_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "njc_supply_items_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "njc_supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          related_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          related_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          bank_reference: string | null
          created_at: string
          id: string
          notes: string | null
          payment_date: string | null
          payment_method: string
          sale_id: string
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_reference?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_method: string
          sale_id: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_reference?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_method?: string
          sale_id?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_payments_sale_id"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_records: {
        Row: {
          account_name: string | null
          account_number: string | null
          allowances: number
          bank_name: string | null
          basic_salary: number
          created_at: string
          deductions: number
          department: string | null
          id: string
          net_pay: number
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          period_end: string
          period_start: string
          position: string | null
          salary_period: string
          staff_id_number: string | null
          staff_name: string
          staff_profile_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          allowances?: number
          bank_name?: string | null
          basic_salary?: number
          created_at?: string
          deductions?: number
          department?: string | null
          id?: string
          net_pay?: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          period_end: string
          period_start: string
          position?: string | null
          salary_period: string
          staff_id_number?: string | null
          staff_name: string
          staff_profile_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          allowances?: number
          bank_name?: string | null
          basic_salary?: number
          created_at?: string
          deductions?: number
          department?: string | null
          id?: string
          net_pay?: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          period_end?: string
          period_start?: string
          position?: string | null
          salary_period?: string
          staff_id_number?: string | null
          staff_name?: string
          staff_profile_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_records_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          price: number
          sku: string | null
          sku_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          price: number
          sku?: string | null
          sku_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          price?: number
          sku?: string | null
          sku_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_products_sku"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reconciliation_reports: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          report_date: string
          report_type: string
          status: string
          total_amount_discrepancy: number
          total_discrepancies: number
          user_id: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          report_date: string
          report_type: string
          status?: string
          total_amount_discrepancy?: number
          total_discrepancies?: number
          user_id: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          report_date?: string
          report_type?: string
          status?: string
          total_amount_discrepancy?: number
          total_discrepancies?: number
          user_id?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          sale_id: string
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_sale_items_product_id"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sale_items_sale_id"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string | null
          id: string
          invoiced_at: string | null
          notes: string | null
          sale_date: string
          sale_number: string
          sale_type: string | null
          status: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          invoiced_at?: string | null
          notes?: string | null
          sale_date: string
          sale_number: string
          sale_type?: string | null
          status?: string
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          invoiced_at?: string | null
          notes?: string | null
          sale_date?: string
          sale_number?: string
          sale_type?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      skus: {
        Row: {
          category: string | null
          cost_per_unit: number | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          reorder_level: number | null
          sku_code: string | null
          stock_quantity: number
          unit_of_measure: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          reorder_level?: number | null
          sku_code?: string | null
          stock_quantity?: number
          unit_of_measure: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          reorder_level?: number | null
          sku_code?: string | null
          stock_quantity?: number
          unit_of_measure?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_complaints: {
        Row: {
          admin_response: string | null
          created_at: string
          description: string
          id: string
          priority: string
          responded_at: string | null
          responded_by: string | null
          staff_profile_id: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          created_at?: string
          description: string
          id?: string
          priority?: string
          responded_at?: string | null
          responded_by?: string | null
          staff_profile_id?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          created_at?: string
          description?: string
          id?: string
          priority?: string
          responded_at?: string | null
          responded_by?: string | null
          staff_profile_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_complaints_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          staff_profile_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          staff_profile_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          staff_profile_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave_requests: {
        Row: {
          admin_response: string | null
          created_at: string
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          responded_at: string | null
          responded_by: string | null
          staff_profile_id: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          created_at?: string
          end_date: string
          id?: string
          leave_type?: string
          reason?: string | null
          responded_at?: string | null
          responded_by?: string | null
          staff_profile_id?: string | null
          start_date: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          created_at?: string
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          responded_at?: string | null
          responded_by?: string | null
          staff_profile_id?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_requests_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          recipient_id: string
          related_id: string | null
          related_type: string | null
          sender_id: string
          subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          recipient_id: string
          related_id?: string | null
          related_type?: string | null
          sender_id: string
          subject: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          recipient_id?: string
          related_id?: string | null
          related_type?: string | null
          sender_id?: string
          subject?: string
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          department_id: string | null
          email_address: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          employment_date: string | null
          employment_type: string | null
          full_name: string
          gender: string | null
          id: string
          level_of_education: string | null
          lga: string | null
          linked_user_id: string | null
          marital_status: string | null
          nin: string | null
          passport_path: string | null
          phone_number: string | null
          position: Database["public"]["Enums"]["staff_position"]
          residential_address: string | null
          salary: number | null
          skills_experience: string | null
          state_of_origin: string | null
          updated_at: string
          user_id: string
          year_of_joining: number | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          department_id?: string | null
          email_address?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employment_date?: string | null
          employment_type?: string | null
          full_name: string
          gender?: string | null
          id?: string
          level_of_education?: string | null
          lga?: string | null
          linked_user_id?: string | null
          marital_status?: string | null
          nin?: string | null
          passport_path?: string | null
          phone_number?: string | null
          position?: Database["public"]["Enums"]["staff_position"]
          residential_address?: string | null
          salary?: number | null
          skills_experience?: string | null
          state_of_origin?: string | null
          updated_at?: string
          user_id: string
          year_of_joining?: number | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          department_id?: string | null
          email_address?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employment_date?: string | null
          employment_type?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          level_of_education?: string | null
          lga?: string | null
          linked_user_id?: string | null
          marital_status?: string | null
          nin?: string | null
          passport_path?: string | null
          phone_number?: string | null
          position?: Database["public"]["Enums"]["staff_position"]
          residential_address?: string | null
          salary?: number | null
          skills_experience?: string | null
          state_of_origin?: string | null
          updated_at?: string
          user_id?: string
          year_of_joining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_take_items: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          counted_quantity: number
          created_at: string
          id: string
          notes: string | null
          sku_id: string
          stock_take_id: string
          system_quantity: number
          updated_at: string
          variance: number
          variance_value: number
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number
          created_at?: string
          id?: string
          notes?: string | null
          sku_id: string
          stock_take_id: string
          system_quantity?: number
          updated_at?: string
          variance?: number
          variance_value?: number
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number
          created_at?: string
          id?: string
          notes?: string | null
          sku_id?: string
          stock_take_id?: string
          system_quantity?: number
          updated_at?: string
          variance?: number
          variance_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_take_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_items_stock_take_id_fkey"
            columns: ["stock_take_id"]
            isOneToOne: false
            referencedRelation: "stock_takes"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_takes: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          status: string
          take_date: string
          total_items_counted: number
          total_variance_value: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          take_date?: string
          total_items_counted?: number
          total_variance_value?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          take_date?: string
          total_items_counted?: number
          total_variance_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          quantity: number
          reference_id: string | null
          sku_id: string
          total_amount: number | null
          transaction_type: string
          unit_price: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quantity: number
          reference_id?: string | null
          sku_id: string
          total_amount?: number | null
          transaction_type: string
          unit_price?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          sku_id?: string
          total_amount?: number | null
          transaction_type?: string
          unit_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_transactions_sku"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          conversion_factor: number
          created_at: string
          from_unit: string
          id: string
          to_unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversion_factor: number
          created_at?: string
          from_unit: string
          id?: string
          to_unit: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversion_factor?: number
          created_at?: string
          from_unit?: string
          id?: string
          to_unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          department_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          role_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          role_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          role_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      budget_summary: {
        Row: {
          created_at: string | null
          end_date: string | null
          expense_count: number | null
          id: string | null
          is_overspent: boolean | null
          percentage_used: number | null
          remaining_budget: number | null
          start_date: string | null
          title: string | null
          total_budget: number | null
          total_spent: number | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_user_role: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "manager" | "employee" | "hr"
      staff_position:
        | "managing_director"
        | "general_manager"
        | "kitchen_manager"
        | "event_manager"
        | "supervisor"
        | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "employee", "hr"],
      staff_position: [
        "managing_director",
        "general_manager",
        "kitchen_manager",
        "event_manager",
        "supervisor",
        "staff",
      ],
    },
  },
} as const
