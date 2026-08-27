import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { ChatInterface } from "@/components/ChatInterface";
import { PictureWorkspace } from "@/components/picture/PictureWorkspace";

const Index = () => {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<"chat" | "image">("chat");

  useEffect(() => {
    if (location.state?.tab === "chat" || location.state?.tab === "image") {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  const renderContent = () => {
    switch (activeTab) {
      case "chat":
        return (
          <div className="relative h-[calc(100dvh-6rem)] min-h-0">
            <ChatInterface onRequestTabChange={setActiveTab} />
          </div>
        );
      case "image":
        return <PictureWorkspace />;
      default:
        return (
          <div className="relative h-[calc(100dvh-6rem)] min-h-0">
            <ChatInterface onRequestTabChange={setActiveTab} />
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <TopBar />
      
      <main className="ml-0 md:ml-20 pt-[calc(env(safe-area-inset-top)+5rem)] md:pt-20 px-0 pb-0 min-h-screen">
        {renderContent()}
      </main>
    </div>
  );
};

export default Index;
