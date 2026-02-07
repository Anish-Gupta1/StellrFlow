"use client";

import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { DraggableNodeItem } from './draggable-node-item';
import { getIconByName } from '@/lib/utils/icons';

interface NodeCategoryProps {
  categoryKey: string;
  category: {
    category: string;
    items: Array<{
      type: string;
      label: string;
      icon: string;
      description: string;
    }>;
  };
}

export function NodeCategory({ categoryKey, category }: NodeCategoryProps) {
  const [isOpen, setIsOpen] = useState(true);
  
  // Automatically open if there's a search result
  useEffect(() => {
    if (category.items.length > 0) {
      setIsOpen(true);
    }
  }, [category.items]);
  
  const toggleOpen = () => setIsOpen(!isOpen);
  
  return (
    <div className="mb-4">
      <button
        className="flex items-center w-full text-left font-medium p-1 rounded-md hover:bg-muted transition-colors mb-1"
        onClick={toggleOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 mr-1" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-1" />
        )}
        {category.category}
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pl-2 space-y-1.5">
              {category.items.map((item) => (
                <DraggableNodeItem
                  key={`${categoryKey}-${item.type}`}
                  type={item.type}
                  label={item.label}
                  icon={getIconByName(item.icon)}
                  description={item.description}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}