"use client";

import { useRef } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { motion } from 'framer-motion';

interface DraggableNodeItemProps {
  type: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

export function DraggableNodeItem({ type, label, icon, description }: DraggableNodeItemProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/reactflow', type);
    event.dataTransfer.effectAllowed = 'move';
    
    if (nodeRef.current) {
      // Create a ghost image for dragging
      const ghostEl = nodeRef.current.cloneNode(true) as HTMLDivElement;
      ghostEl.style.position = 'absolute';
      ghostEl.style.top = '-1000px';
      document.body.appendChild(ghostEl);
      
      event.dataTransfer.setDragImage(ghostEl, 0, 0);
      
      // Clean up the ghost element after dragging
      setTimeout(() => {
        document.body.removeChild(ghostEl);
      }, 0);
    }
  };
  
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div
          ref={nodeRef}
          draggable
          onDragStart={onDragStart}
          className="flex items-center p-2 rounded-md cursor-grab border border-border bg-card hover:bg-accent/10 transition-colors text-sm"
        >
          <motion.div 
            className="mr-2 text-primary" 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            {icon}
          </motion.div>
          <span>{label}</span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-4">
        <div className="space-y-2">
          <div className="flex items-center">
            <div className="mr-2 text-primary">{icon}</div>
            <h4 className="font-medium">{label}</h4>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="text-xs text-muted-foreground italic">
            Drag to add to your workflow
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}