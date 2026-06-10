# Two-stage build: compile in golang:1.22 then scratch-tier the binary.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download || true
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/mithras-dns-resolver .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/mithras-dns-resolver /mithras-dns-resolver
EXPOSE 8053
USER nonroot:nonroot
ENTRYPOINT ["/mithras-dns-resolver"]
