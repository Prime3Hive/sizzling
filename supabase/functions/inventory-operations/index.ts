import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

interface PurchaseRequest {
  sku_id: string;
  quantity: number;
  unit_price?: number;
  notes?: string;
}

interface ProductionRequest {
  parent_sku_id: string;
  quantity: number;
  notes?: string;
}

interface SaleRequest {
  sku_id: string;
  quantity: number;
  unit_price?: number;
  reference_id?: string;
  notes?: string;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from Authorization header
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { operation, ...params } = body;

    // Validate operation
    if (!operation || !['purchase', 'production', 'sale'].includes(operation)) {
      return new Response(JSON.stringify({ error: 'Invalid operation' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate common params
    if (operation === 'purchase' || operation === 'sale') {
      if (!params.sku_id || typeof params.sku_id !== 'string') {
        return new Response(JSON.stringify({ error: 'Invalid sku_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (typeof params.quantity !== 'number' || params.quantity <= 0 || params.quantity > 999999) {
        return new Response(JSON.stringify({ error: 'Invalid quantity' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    if (operation === 'production') {
      if (!params.parent_sku_id || typeof params.parent_sku_id !== 'string') {
        return new Response(JSON.stringify({ error: 'Invalid parent_sku_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (typeof params.quantity !== 'number' || params.quantity <= 0 || params.quantity > 999999) {
        return new Response(JSON.stringify({ error: 'Invalid quantity' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`Processing ${operation} operation for user ${user.id}`);

    let result;

    switch (operation) {
      case 'purchase':
        result = await recordPurchase(supabase, user.id, params as PurchaseRequest);
        break;
      case 'production':
        result = await recordProduction(supabase, user.id, params as ProductionRequest);
        break;
      case 'sale':
        result = await recordSale(supabase, user.id, params as SaleRequest);
        break;
      default:
        return new Response(JSON.stringify({ error: 'Invalid operation' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in inventory-operations function:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Record purchase transaction and update stock
async function recordPurchase(supabase: any, userId: string, params: PurchaseRequest) {
  const { sku_id, quantity, unit_price = 0, notes } = params;

  // Start transaction
  const { data: sku, error: skuError } = await supabase
    .from('skus')
    .select('*')
    .eq('id', sku_id)
    .eq('user_id', userId)
    .single();

  if (skuError) throw new Error(`SKU not found: ${skuError.message}`);

  // Create transaction record
  const { error: transactionError } = await supabase
    .from('transactions')
    .insert({
      transaction_type: 'PURCHASE',
      sku_id,
      quantity,
      unit_price,
      total_amount: quantity * unit_price,
      notes,
      user_id: userId,
      created_by: userId
    });

  if (transactionError) throw new Error(`Transaction failed: ${transactionError.message}`);

  // Update SKU stock
  const newStock = parseFloat(sku.stock_quantity) + quantity;
  const { error: updateError } = await supabase
    .from('skus')
    .update({ 
      stock_quantity: newStock,
      updated_at: new Date().toISOString()
    })
    .eq('id', sku_id);

  if (updateError) throw new Error(`Stock update failed: ${updateError.message}`);

  return { 
    success: true, 
    message: `Purchase recorded: ${quantity} ${sku.unit_of_measure} of ${sku.name}`,
    new_stock: newStock
  };
}

// Record production and process BOM
async function recordProduction(supabase: any, userId: string, params: ProductionRequest) {
  const { parent_sku_id, quantity, notes } = params;

  // Get parent SKU
  const { data: parentSku, error: parentError } = await supabase
    .from('skus')
    .select('*')
    .eq('id', parent_sku_id)
    .eq('user_id', userId)
    .single();

  if (parentError) throw new Error(`Parent SKU not found: ${parentError.message}`);

  // Get BOM for this parent SKU
  const { data: bomItems, error: bomError } = await supabase
    .from('bill_of_materials')
    .select(`
      *,
      component_sku:skus!component_sku_id(*)
    `)
    .eq('parent_sku_id', parent_sku_id)
    .eq('user_id', userId);

  if (bomError) throw new Error(`BOM lookup failed: ${bomError.message}`);

  if (!bomItems || bomItems.length === 0) {
    throw new Error('No bill of materials found for this SKU');
  }

  // Check if we have enough raw materials
  for (const bomItem of bomItems) {
    const requiredQuantity = parseFloat(bomItem.quantity) * quantity;
    const availableStock = parseFloat(bomItem.component_sku.stock_quantity);
    
    if (availableStock < requiredQuantity) {
      throw new Error(`Insufficient stock of ${bomItem.component_sku.name}. Required: ${requiredQuantity}, Available: ${availableStock}`);
    }
  }

  // Process production - deduct raw materials
  for (const bomItem of bomItems) {
    const requiredQuantity = parseFloat(bomItem.quantity) * quantity;
    const newStock = parseFloat(bomItem.component_sku.stock_quantity) - requiredQuantity;

    // Update component stock
    const { error: updateError } = await supabase
      .from('skus')
      .update({ 
        stock_quantity: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', bomItem.component_sku_id);

    if (updateError) throw new Error(`Failed to update component stock: ${updateError.message}`);

    // Record consumption transaction
    const { error: transactionError } = await supabase
      .from('transactions')
      .insert({
        transaction_type: 'PRODUCTION',
        sku_id: bomItem.component_sku_id,
        quantity: -requiredQuantity, // Negative for consumption
        notes: `Used in production of ${parentSku.name}`,
        user_id: userId,
        created_by: userId
      });

    if (transactionError) throw new Error(`Failed to record consumption: ${transactionError.message}`);
  }

  // Add finished product to stock
  const newFinishedStock = parseFloat(parentSku.stock_quantity) + quantity;
  const { error: finishedUpdateError } = await supabase
    .from('skus')
    .update({ 
      stock_quantity: newFinishedStock,
      updated_at: new Date().toISOString()
    })
    .eq('id', parent_sku_id);

  if (finishedUpdateError) throw new Error(`Failed to update finished product stock: ${finishedUpdateError.message}`);

  // Record production transaction
  const { error: productionTransactionError } = await supabase
    .from('transactions')
    .insert({
      transaction_type: 'PRODUCTION',
      sku_id: parent_sku_id,
      quantity,
      notes,
      user_id: userId,
      created_by: userId
    });

  if (productionTransactionError) throw new Error(`Failed to record production: ${productionTransactionError.message}`);

  return { 
    success: true, 
    message: `Production recorded: ${quantity} ${parentSku.unit_of_measure} of ${parentSku.name}`,
    new_stock: newFinishedStock
  };
}

// Record sale and handle combo deductions
async function recordSale(supabase: any, userId: string, params: SaleRequest) {
  const { sku_id, quantity, unit_price = 0, reference_id, notes } = params;

  // Get SKU details
  const { data: sku, error: skuError } = await supabase
    .from('skus')
    .select('*')
    .eq('id', sku_id)
    .eq('user_id', userId)
    .single();

  if (skuError) throw new Error(`SKU not found: ${skuError.message}`);

  // Check stock availability
  if (parseFloat(sku.stock_quantity) < quantity) {
    throw new Error(`Insufficient stock. Available: ${sku.stock_quantity}, Requested: ${quantity}`);
  }

  // If it's a combo pack, deduct components
  if (sku.sku_type === 'CB') {
    const { data: bomItems, error: bomError } = await supabase
      .from('bill_of_materials')
      .select(`
        *,
        component_sku:skus!component_sku_id(*)
      `)
      .eq('parent_sku_id', sku_id)
      .eq('user_id', userId);

    if (bomError) throw new Error(`BOM lookup failed: ${bomError.message}`);

    // Deduct component SKUs
    for (const bomItem of bomItems) {
      const requiredQuantity = parseFloat(bomItem.quantity) * quantity;
      const newComponentStock = parseFloat(bomItem.component_sku.stock_quantity) - requiredQuantity;

      const { error: updateError } = await supabase
        .from('skus')
        .update({ 
          stock_quantity: newComponentStock,
          updated_at: new Date().toISOString()
        })
        .eq('id', bomItem.component_sku_id);

      if (updateError) throw new Error(`Failed to update component stock: ${updateError.message}`);
    }
  }

  // Deduct main SKU stock
  const newStock = parseFloat(sku.stock_quantity) - quantity;
  const { error: updateError } = await supabase
    .from('skus')
    .update({ 
      stock_quantity: newStock,
      updated_at: new Date().toISOString()
    })
    .eq('id', sku_id);

  if (updateError) throw new Error(`Stock update failed: ${updateError.message}`);

  // Record sale transaction
  const { error: transactionError } = await supabase
    .from('transactions')
    .insert({
      transaction_type: 'SALE',
      sku_id,
      quantity: -quantity, // Negative for sale
      unit_price,
      total_amount: quantity * unit_price,
      reference_id,
      notes,
      user_id: userId,
      created_by: userId
    });

  if (transactionError) throw new Error(`Transaction failed: ${transactionError.message}`);

  return { 
    success: true, 
    message: `Sale recorded: ${quantity} ${sku.unit_of_measure} of ${sku.name}`,
    new_stock: newStock
  };
}