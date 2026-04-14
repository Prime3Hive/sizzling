import React from 'react';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';

interface ReceiptItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface ReceiptProps {
  saleNumber: string;
  saleDate: string;
  customerName?: string;
  customerEmail?: string;
  items: ReceiptItem[];
  totalAmount: number;
  notes?: string;
}

export const Receipt: React.FC<ReceiptProps> = ({
  saleNumber,
  saleDate,
  customerName,
  customerEmail,
  items,
  totalAmount,
  notes
}) => {
  return (
    <div className="max-w-md mx-auto bg-white text-black p-6 font-mono text-sm">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto mb-2 bg-gradient-primary rounded-lg p-2">
          <img 
            src="/favicon.png" 
            alt="Sizzling Spices Logo" 
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="text-lg font-bold">SIZZLING SPICES</h1>
        <p className="text-xs">Invoice</p>
      </div>

      {/* Receipt Details */}
      <div className="border-t border-b border-gray-300 py-2 mb-4">
        <div className="flex justify-between">
          <span>Receipt No:</span>
          <span className="font-semibold">{saleNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{format(new Date(saleDate), 'dd/MM/yyyy HH:mm')}</span>
        </div>
        {customerName && (
          <div className="flex justify-between">
            <span>Customer:</span>
            <span>{customerName}</span>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="mb-4">
        <div className="border-b border-gray-300 pb-1 mb-2">
          <div className="grid grid-cols-8 gap-2 text-xs font-semibold">
            <div className="col-span-3">ITEM</div>
            <div className="text-center">QTY</div>
            <div className="col-span-2 text-right">PRICE</div>
            <div className="col-span-2 text-right">TOTAL</div>
          </div>
        </div>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-8 gap-2 text-xs mb-1">
            <div className="col-span-3 truncate">{item.product_name}</div>
            <div className="text-center">{item.quantity}</div>
            <div className="col-span-2 text-right">{formatNairaCompact(item.unit_price)}</div>
            <div className="col-span-2 text-right font-semibold">{formatNairaCompact(item.total_price)}</div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="border-t border-gray-300 pt-2 mb-4">
        <div className="flex justify-between text-lg font-bold">
          <span>TOTAL:</span>
          <span>{formatNairaCompact(totalAmount)}</span>
        </div>
      </div>

      {/* Notes */}
      {notes && (
        <div className="mb-4 text-xs">
          <div className="font-semibold">Notes:</div>
          <div>{notes}</div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs border-t border-gray-300 pt-4">
        <p className="font-semibold">Thank you for your patronage!</p>
        <p>Visit us again soon</p>
        <p className="mt-2 text-gray-600">
          Powered by Sizzling Spices Management System
        </p>
      </div>
    </div>
  );
};

export default Receipt;