-- CreateIndex (composite - optimizes customer queries filtered by status)
CREATE INDEX "service_requests_customer_id_status_idx" ON "service_requests"("customer_id", "status");

-- CreateIndex (composite - optimizes handyman queries filtered by status)
CREATE INDEX "service_requests_assigned_handyman_id_status_idx" ON "service_requests"("assigned_handyman_id", "status");

-- CreateIndex (composite - optimizes application queries filtered by status)
CREATE INDEX "service_request_applications_handyman_profile_id_status_idx" ON "service_request_applications"("handyman_profile_id", "status");
