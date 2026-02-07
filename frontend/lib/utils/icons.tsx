"use client";

import React from 'react';
import { Webhook, Clock, FormInput, Mail, Globe, Filter, Repeat, Workflow, MessageCircle, DivideIcon as LucideIcon } from 'lucide-react';

type IconMap = {
  [key: string]: React.ReactNode;
};

const icons: IconMap = {
  webhook: <Webhook className="h-4 w-4" />,
  clock: <Clock className="h-4 w-4" />,
  formInput: <FormInput className="h-4 w-4" />,
  mail: <Mail className="h-4 w-4" />,
  globe: <Globe className="h-4 w-4" />,
  filter: <Filter className="h-4 w-4" />,
  repeat: <Repeat className="h-4 w-4" />,
  workflow: <Workflow className="h-4 w-4" />,
  messageCircle: <MessageCircle className="h-4 w-4" />,
};

export function getIconByName(name: string): React.ReactNode {
  return icons[name] || <Workflow className="h-4 w-4" />; // Default icon
}