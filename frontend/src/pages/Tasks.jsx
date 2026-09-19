import React from 'react';
import TasksView from '../components/TasksView';

// Standalone tasks have no project scope, so they get their own page rather than
// sitting on top of the Projects list.
export default function Tasks() {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">Tasks</div>
      </div>
      <TasksView />
    </div>
  );
}
